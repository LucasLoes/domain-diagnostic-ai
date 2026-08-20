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
        Atue como um Engenheiro de Infraestrutura Cloud e Especialista em Migrações e Inteligência de Negócios (Pré-vendas).
        Analise o domínio: ${dominio}.

        Dados DNS Coletados:
        - A (IPv4): ${JSON.stringify(dnsData.A)}
        - MX (E-mail): ${JSON.stringify(dnsData.MX)}
        - NS (Name Servers): ${JSON.stringify(dnsData.NS)}
        - TXT (Raiz): ${JSON.stringify(dnsData.TXT)}
        - DMARC (_dmarc): ${JSON.stringify(dnsData.DMARC)}

        Dados RDAP (Titularidade):
        ${JSON.stringify(whoisData.entities ? whoisData.entities : 'Dados de titular ocultos pela LGPD')}

        Sua tarefa é fornecer um relatório em Markdown estruturado para duas audiências: a **Equipe Comercial** e a **Equipe Técnica**. 
        O objetivo é que a equipe comercial tenha "insights" (gatilhos de vendas) antes da reunião, e a equipe técnica saiba exatamente com o que está lidando.

        ### 🎯 VISÃO COMERCIAL (Business Intelligence & Insights)
        Esta seção deve ser de fácil entendimento para o time de vendas.
        1. **Stack Tecnológico Identificado:** Analise profundamente os registros TXT, SPF e MX para descobrir os sistemas integrados ao domínio do cliente. Liste-os claramente:
           - **Sistemas de E-mail Marketing e Automação:** (ex: Mailchimp, RD Station, ActiveCampaign, SendGrid, Amazon SES, etc.) encontrados no SPF.
           - **Sistemas ERP / CRM / Atendimento:** Ferramentas de gestão ou validações de domínio (ex: Zendesk, Salesforce, etc.).
           - **E-commerce / Plataforma Web:** Validações de ferramentas como Shopify, Vtex, Facebook Domain Verification, Google Search Console, etc.
        2. **Dores Potenciais e Oportunidades de Venda:** Com base no cenário atual (ex: e-mail básico vs. corporativo, ausência de segurança DMARC, uso de múltiplas ferramentas de marketing), o que a equipe comercial pode oferecer? Forneça argumentos práticos de venda (ex: "O cliente usa Titan Email, uma oportunidade para oferecer Google Workspace/Microsoft 365 para maior produtividade", "Falta DMARC, oportunidade de vender consultoria de segurança de e-mail").

        ### ⚙️ ANÁLISE TÉCNICA DE INFRAESTRUTURA
        Esta seção é para o analista que conduzirá a migração/suporte.
        3. **Propriedade do Domínio:** Quem é o titular (dados do RDAP, se disponíveis).
        4. **Infraestrutura de Hospedagem:** Analise os NS e registros A para identificar o provedor real (ex: HostGator, AWS, Cloudflare).
        5. **Serviço de E-mail Atual:** Identifique precisamente o provedor pelos registros MX.
        6. **Saúde de Entregabilidade (SPF/DMARC):** Avalie criticamente. O SPF está bem construído? O DMARC existe e qual a política (none, quarantine, reject)?
        7. **Histórico de Plataformas:** Verifique registros TXT em busca de indícios de uso de Google Workspace ('google-site-verification') ou Microsoft 365.
        8. **Plano de Ação (Migração):** Destaque os riscos e os pontos de atenção críticos (ex: redução de TTL, backup de contas, configurações específicas) para uma eventual migração.
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
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
        
        res.status(500).json({ 
            erro: 'Erro interno no servidor ao processar a análise.',
            detalhe: error.message || error.toString()
        });
    }
}
