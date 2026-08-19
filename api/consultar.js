import dns from 'dns/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { dominio } = req.query;

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
            const rdapResponse = await fetch(`https://rdap.registro.br/domain/${dominio}`);
            if (rdapResponse.ok) {
                whoisData = await rdapResponse.json();
            }
        } catch(e) {
            console.log("Falha ao resolver RDAP");
        }

        const prompt = `
        Atue como um Engenheiro de Infraestrutura Cloud e Especialista em Migrações de E-mail corporativo.
        Analise o domínio: ${dominio}.

        Dados DNS Coletados:
        - A (IPv4): ${JSON.stringify(dnsData.A)}
        - MX (E-mail): ${JSON.stringify(dnsData.MX)}
        - NS (Name Servers): ${JSON.stringify(dnsData.NS)}
        - TXT (Raiz): ${JSON.stringify(dnsData.TXT)}
        - DMARC (_dmarc): ${JSON.stringify(dnsData.DMARC)}

        Dados RDAP (Titularidade):
        ${JSON.stringify(whoisData.entities ? whoisData.entities : 'Dados de titular ocultos pela LGPD')}

        Sua tarefa é fornecer um relatório técnico em Markdown com a seguinte estrutura:
        1. **Propriedade do Domínio:** Quem é o titular (caso disponível no RDAP).
        2. **Infraestrutura de Hospedagem:** Analise os NS e apontamentos A. Identifique o provedor real (ex: desmascare NS genéricos se aplicável).
        3. **Serviço de E-mail Atual:** Identifique o provedor de e-mail pelos registros MX.
        4. **Saúde de Entregabilidade:** Avalie se há DMARC e SPF configurados nos TXTs.
        5. **Histórico Google Workspace:** Verifique nos registros TXT se existe 'google-site-verification'.
        6. **Plano de Ação para Migração:** Destaque os pontos de atenção críticos para um técnico que fará a migração deste ambiente.
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const aiResult = await model.generateContent(prompt);
        
        res.status(200).json({
            dominio,
            dados_brutos: { dns: dnsData, rdap: whoisData.entities || "Não público" },
            relatorio_ia: aiResult.response.text()
        });

    } catch (error) {
        console.error(error);
        
        if (error.message && error.message.includes("API key not valid")) {
             return res.status(500).json({ erro: 'A chave de API do Gemini configurada na Vercel é inválida (ela geralmente começa com AIza...). Acesse o Google AI Studio para gerar uma válida.' });
        }
        
        res.status(500).json({ erro: 'Erro interno no servidor ao processar a análise.' });
    }
}
