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

        let webStatus = null;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const httpResponse = await fetch(`https://${dominio}`, {
                method: 'HEAD',
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            clearTimeout(timeoutId);
            webStatus = {
                status: httpResponse.status,
                statusText: httpResponse.statusText,
                server: httpResponse.headers.get('server') || 'Desconhecido',
                poweredBy: httpResponse.headers.get('x-powered-by') || 'Não informado'
            };
        } catch(e) {
            webStatus = { erro: 'Inacessível / Timeout' };
        }

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
        IMPORTANTE: O fortalecimento do DMARC (ex: mudar de p=none para p=reject) NÃO deve ser considerado como uma oportunidade de consultoria ou serviço. Essa decisão é exclusiva dos administradores de e-mail do cliente. Não sugira segurança de e-mail como oportunidade.

        Dados DNS:
        - A: ${JSON.stringify(dnsData.A)}
        - MX: ${JSON.stringify(dnsData.MX)}
        - NS: ${JSON.stringify(dnsData.NS)}
        - TXT: ${JSON.stringify(dnsData.TXT)}
        - DMARC: ${JSON.stringify(dnsData.DMARC)}
        Dados Titularidade (RDAP): ${JSON.stringify(whoisData)}
        Status HTTP Web: ${JSON.stringify(webStatus)}
        Dados CNPJ: ${cnpjData ? JSON.stringify(cnpjData) : 'Não informado'}
        Dados CEP: ${cepData ? JSON.stringify(cepData) : 'Não informado'}

        Cruze as informações (ex: use os dados do CNPJ para preencher lacunas do domínio, como contatos, se o RDAP estiver vazio) para fornecer o relatório mais completo e apurado possível sobre as informações técnicas, administrativas e comerciais.

        Estruture em Markdown:

        ### 🎯 Visão Comercial (Resumo)
        * **Stack Atual:** (Ferramentas de email, CRM, e marketing identificadas).
        * **Oportunidades:** (Principais gatilhos de venda, ex: otimização de hospedagem, novo site, serviços digitais relacionados ao CNAE da empresa. NÃO oferte consultoria de e-mail ou DMARC).

        ### ⚙️ Visão Técnica (Resumo)
        * **Contatos do Domínio:**
          - **Titular:** (Nome e e-mail do titular. Se RDAP vazio, use a Razão Social/Sócios do CNPJ)
          - **Técnico:** (Contato técnico. Se RDAP vazio, verifique dados no CNPJ)
        * **Datas:**
          - **Criação:** (Data de criação do domínio ou abertura do CNPJ)
          - **Alteração:** (Data da última alteração)
          - **Expiração:** (Data de expiração, se houver)
        * **Provedor DNS:** (Definido exclusivamente pelo servidor NS).
        * **Hospedagem do Site:** (Provedor de hospedagem descoberto analisando o apontamento do tipo A e Status HTTP).
        * **Status Web:**
          - **Acesso:** (Responde HTTP 200, falhou, redirecionou, etc)
          - **Servidor:** (Qual servidor web reportado)
        * **E-mail Atual:** (Servidor de e-mails definido pelos registros MX).
        * **Segurança:**
          - **SPF:** (Status da configuração)
          - **DMARC:** (Status da política. Apenas reporte o que está configurado, sem classificar como fraca/insegura, pois isso é decisão do cliente).
        * **Atenção:** (Somente riscos críticos operacionais, se houver).

        ### 🏢 Análise da Empresa (CNPJ)
        * **Identificação:** (Status e Razão Social exata)
        * **Dados Cadastrais:**
          - **Abertura:** (Data de abertura)
          - **Capital Social:** (Valor em R$ formatado)
          - **Natureza Jurídica:** (Natureza informada)
        * **Atividade Principal:** (Código CNAE e descrição da atividade)
        * **Sócios Principais:**
          - (Nome do sócio e cargo/qualificação - listar até 3 principais)
        
        ### 📍 Localização (CEP)
        * **Endereço:** (Endereço completo baseado no CNPJ e CEP, incluindo coordenadas se disponíveis)
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const aiResult = await model.generateContent(prompt);
        
        res.status(200).json({
            dominio,
            dados_brutos: { dns: dnsData, rdap: whoisData.entities || "Não público", web: webStatus, cnpj: cnpjData, cep: cepData },
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
