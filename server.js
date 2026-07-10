import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_PATH = '/mcp';
const TEMPLATE_URI = 'ui://widget/specular.html';
const port = Number(process.env.PORT || 8787);

const starter = {
  mode: 'clarify',
  title: 'What are you actually trying to understand?',
  question:
    'Take the thought in front of you and zoom out one level. Is the real question about facts, values, timing, fear, taste, obligation, or identity?',
  lens: 'core question',
};

function titleCaseMode(mode) {
  const normalized = String(mode || 'clarify').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function trimThought(thought) {
  return String(thought || '').trim().replace(/\s+/g, ' ').slice(0, 240);
}

function sharpen({ thought, mode = 'clarify' }) {
  const clean = trimThought(thought);
  const normalizedMode = String(mode || 'clarify').toLowerCase();

  if (!clean) {
    return {
      thought: 'Bring any thought you want to make sharper.',
      mode: titleCaseMode(normalizedMode),
      ...starter,
    };
  }

  if (normalizedMode === 'invert') {
    return {
      thought: clean,
      mode: 'Invert',
      title: 'Invert the frame',
      question: `If “${clean}” were backwards, what would have to be true? What does the reversed version reveal about the assumption you were carrying?`,
      lens: 'generated inversion',
      followUps: [
        'What would a thoughtful opponent say you are missing?',
        'Which part of the reversed view feels uncomfortably plausible?',
        'What assumption survives both versions?',
      ],
    };
  }

  if (normalizedMode === 'distill') {
    return {
      thought: clean,
      mode: 'Distill',
      title: 'Find the load-bearing distinction',
      question: `Inside “${clean}”, which distinction matters most? Define the two sides so clearly that someone could disagree with the exact point instead of the general mood.`,
      lens: 'generated distillation',
      followUps: [
        'Which word needs a stricter definition?',
        'What is central, and what is decorative?',
        'Can the claim be made in one falsifiable sentence?',
      ],
    };
  }

  return {
    thought: clean,
    mode: 'Clarify',
    title: 'Clarify the claim',
    question: `When you say “${clean}”, what is the smallest precise claim you are making? What would be different in the world if that claim were true?`,
    lens: 'generated clarification',
    followUps: [
      'What are you assuming but not saying?',
      'What would count as evidence against it?',
      'Where does the idea become vague if pressed?',
    ],
  };
}

function createSpecularServer() {
  const server = new McpServer(
    { name: 'Specular', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  const widgetHtml = readFileSync(join(__dirname, 'public', 'specular-widget.html'), 'utf8');

  registerAppResource(server, 'specular-widget', TEMPLATE_URI, {}, async () => ({
    contents: [
      {
        uri: TEMPLATE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml,
        _meta: {
          ui: {
            prefersBorder: true,
          },
        },
      },
    ],
  }));

  server.registerTool(
    'sharpen_thought',
    {
      title: 'Sharpen thought',
      description:
        'Turn a rough thought into a sharper question. Use this for beliefs, decisions, arguments, plans, drafts, questions, or vague intuitions. Modes: clarify, invert, distill.',
      inputSchema: {
        thought: z.string().describe('The rough thought, idea, argument, belief, or intuition to sharpen.'),
        mode: z.enum(['clarify', 'invert', 'distill']).default('clarify'),
      },
      outputSchema: {
        thought: z.string(),
        mode: z.string(),
        title: z.string(),
        question: z.string(),
        lens: z.string(),
        followUps: z.array(z.string()).optional(),
      },
      securitySchemes: [{ type: 'noauth' }],
      _meta: {
        'openai/toolInvocation/invoking': 'Sharpening…',
        'openai/toolInvocation/invoked': 'Sharpened.',
      },
    },
    async ({ thought, mode }) => {
      const result = sharpen({ thought, mode });
      return {
        structuredContent: result,
        content: [
          {
            type: 'text',
            text: `${result.title}: ${result.question}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'open_specular',
    {
      title: 'Open Specular',
      description:
        'Render the Specular thinking surface in ChatGPT. Usually call sharpen_thought first, then pass its structured result here.',
      inputSchema: {
        thought: z.string().optional(),
        mode: z.enum(['clarify', 'invert', 'distill']).default('clarify'),
        title: z.string().optional(),
        question: z.string().optional(),
        lens: z.string().optional(),
        followUps: z.array(z.string()).optional(),
      },
      outputSchema: {
        thought: z.string(),
        mode: z.string(),
        title: z.string(),
        question: z.string(),
        lens: z.string(),
        followUps: z.array(z.string()).optional(),
      },
      securitySchemes: [{ type: 'noauth' }],
      _meta: {
        ui: { resourceUri: TEMPLATE_URI },
        'openai/outputTemplate': TEMPLATE_URI,
        'openai/toolInvocation/invoking': 'Opening Specular…',
        'openai/toolInvocation/invoked': 'Specular opened.',
      },
    },
    async (args) => {
      const fallback = sharpen({ thought: args.thought || '', mode: args.mode });
      const result = {
        ...fallback,
        ...Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)),
        mode: titleCaseMode(args.mode || fallback.mode),
      };
      return {
        structuredContent: result,
        content: [
          {
            type: 'text',
            text: `Opened Specular with: ${result.title}`,
          },
        ],
      };
    },
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end('Missing URL');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, mcp-session-id',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`Specular MCP server. Connect ChatGPT to http://localhost:${port}${MCP_PATH}`);
    return;
  }

  const MCP_METHODS = new Set(['POST', 'GET', 'DELETE']);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    const server = createSpecularServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.writeHead(500).end('Internal server error');
      }
    }
    return;
  }

  res.writeHead(404).end('Not Found');
});

httpServer.listen(port, () => {
  console.log(`Specular MCP server listening on http://localhost:${port}${MCP_PATH}`);
});
