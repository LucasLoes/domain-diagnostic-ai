import dns from 'dns/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { dominio, cnpj, cep } = req.query;

    if (!dominio) {
        return res.status(400).json({ erro: 'Domínio não fornecido na querystring.' });
    }

    try {
        const dnsData = { A: [], MX: [], NS: [], TXT: [], DMARC: [] };
        
        const safeResolve = async (fn, ...args) => {
            try { return await fn(...args); } catch (e) { return []; }
        };

        dnsData.A = await safeResolve(dns.resolve4, dominio);
        dnsData.MX = await safeResolve(dns.resolveMx, dominio);
        dnsData.NS = await safeResolve(dns.resolveNs, dominio);
        dnsData.TXT = await safeResolve(dns.resolveTxt, dominio);
        dnsData.DMARC = await safeResolve(dns.resolveTxt, `_dmarc.${dominio}`);

        let whoisData = {};
        try {
            const rdapResponse = await fetch(`https://rdap.registro.br/domain/${dominio}`, {
                headers: { 'User-Agent': 'DomainDiagnosticAI/1.0' }
            });
            if (rdapResponse.ok) {
                whoisData = await rdapResponse.json();
            }
        } catch(e) {
            console.log("Falha ao resolver RDAP");
        }

        let cnpjData = null;
        if (cnpj) {
            const cleanCnpj = cnpj.replace(/\D/g, '');
            if (cleanCnpj.length === 14) {
                try {
                    const cnpjResponse = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`, {
                        headers: { 'User-Agent': 'DomainDiagnosticAI/1.0' }
                    });
                    if (cnpjResponse.ok) {
                        cnpjData = await cnpjResponse.json();
                    }
                } catch(e) {
                    console.log("Falha ao consultar CNPJ");
                }
            }
        }

        let cepData = null;
        if (cep) {
            const cleanCep = cep.replace(/\D/g, '');
            if (cleanCep.length === 8) {
                try {
                    const cepResponse = await fetch(`https://brasilapi.com.br/api/cep/v2/${cleanCep}`, {
                        headers: { 'User-Agent': 'DomainDiagnosticAI/1.0' }
                    });
                    if (cepResponse.ok) {
                        cepData = await cepResponse.json();
                    }
                } catch(e) {
                    console.log("Falha ao consultar CEP");
                }
            }
        }

        const prompt = `
        Analise o domínio: ${dominio}.
        ATENÇÃO: O relatório deve ser um RESUMO RÁPIDO, CURTO e DIRETO AO ASSUNTO, contendo SOMENTE os pontos mais importantes para consulta rápida. Use bullet points curtos. Sem introduções ou conclusões longas.

        Dados DNS:
        - A: ${JSON.stringify(dnsData.A)}
        - MX: ${JSON.stringify(dnsData.MX)}
        - NS: ${JSON.stringify(dnsData.NS)}
        - TXT: ${JSON.stringify(dnsData.TXT)}
        - DMARC: ${JSON.stringify(dnsData.DMARC)}
        Dados Titularidade (RDAP): ${JSON.stringify(whoisData)}
        Dados CNPJ: ${cnpjData ? JSON.stringify(cnpjData) : 'Não informado'}
        Dados CEP: ${cepData ? JSON.stringify(cepData) : 'Não informado'}

        Estruture em Markdown:

        ### 🎯 Visão Comercial (Resumo)
        * **Stack Atual:** (Ferramentas de email, CRM, e marketing identificadas).
        * **Oportunidades:** (Principais gatilhos de venda, ex: vender upgrade de e-mail ou consultoria de segurança).

        ### ⚙️ Visão Técnica (Resumo)
        * **Contatos do Domínio:** (Nome e e-mail do titular e do contato técnico do Registro.br).
        * **Datas:** (Data de criação do domínio e data da última alteração).
        * **Provedor DNS:** (Definido exclusivamente pelo servidor NS).
        * **Hospedagem do Site:** (Provedor de hospedagem descoberto analisando o apontamento do tipo A).
        * **E-mail Atual:** (Servidor de e-mails definido exclusivamente pelos registros MX).
        * **Segurança:** (Status do SPF e DMARC).
        * **Atenção:** (Somente riscos críticos para migração, se houver).

        ### 🏢 Análise da Empresa (CNPJ)
        * **Status:** (Ativa/Inativa e razão social - se CNPJ fornecido)
        * **Idade & Capital:** (Data de abertura e capital social - se CNPJ fornecido)
        * **Atividades:** (CNAE principal - se CNPJ fornecido)
        * **Sócios:** (Principais nomes - se CNPJ fornecido)
        
        ### 📍 Localização (CEP)
        * **Endereço:** (Rua, bairro, cidade, estado e coordenadas se houver - se CEP fornecido)
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const aiResult = await model.generateContent(prompt);
        
        res.status(200).json({
            dominio,
            dados_brutos: { dns: dnsData, rdap: whoisData.entities || "Não público", cnpj: cnpjData, cep: cepData },
            relatorio_ia: aiResult.response.text()
        });

    } catch (error) {
        console.error(error);
        
        if (error.message && error.message.includes("API key not valid")) {
             return res.status(500).json({ erro: 'A chave de API do Gemini configurada na Vercel é inválida (ela geralmente começa com AIza...). Acesse o Google AI Studio para gerar uma válida.' });
        }
        
        res.status(500).json({ 
            erro: 'Erro interno no servidor ao processar a análise.',
            detalhe: error.message || error.toString()
        });
    }
}
