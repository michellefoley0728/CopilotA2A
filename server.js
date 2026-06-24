// Incident Analysis A2A Agent
// Analyzes incidents by searching a local corpus of documents
// Deploy to Railway — set Agent Card URL in ServiceNow to: https://YOUR-PROJECT.up.railway.app/.well-known/agent.json

const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

// ── CORS (ServiceNow needs this) ──────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, A2A-Version');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── EMBEDDING & VECTOR SEARCH ────────────────────────────────────────────────
// Simple TF-IDF + cosine similarity for document matching (no external API)

class DocumentCorpus {
  constructor() {
    this.documents = [];
    this.vocabulary = new Set();
    this.vectorCache = {};
  }

  // Load documents from /corpus folder
  loadCorpus(corpusPath) {
    if (!fs.existsSync(corpusPath)) {
      console.log(`Corpus folder not found at ${corpusPath}, using empty corpus`);
      return;
    }

    const files = fs.readdirSync(corpusPath);
    files.forEach(file => {
      if (file.endsWith('.txt')) {
        const filePath = path.join(corpusPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        this.documents.push({
          name: file,
          content: content,
          tokens: this.tokenize(content)
        });
        this.vocabulary = new Set([...this.vocabulary, ...this.documents[this.documents.length - 1].tokens]);
      }
    });

    console.log(`Loaded ${this.documents.length} documents from corpus`);
  }

  // Simple tokenization
  tokenize(text) {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(token => token.length > 2) // ignore short tokens
      .map(token => token.replace(/[^\w]/g, ''));
  }

  // Compute TF-IDF vector for a document
  getTFIDFVector(tokens) {
    const vector = {};
    const docFreq = {};

    // Count term frequencies in this document
    tokens.forEach(token => {
      vector[token] = (vector[token] || 0) + 1;
    });

    // Normalize by document length and apply IDF
    const docLength = tokens.length;
    Object.keys(vector).forEach(token => {
      // Count how many documents contain this token
      const docsWithToken = this.documents.filter(doc => doc.tokens.includes(token)).length;
      const idf = Math.log((this.documents.length + 1) / (docsWithToken + 1));
      vector[token] = (vector[token] / docLength) * idf;
    });

    return vector;
  }

  // Cosine similarity between two vectors
  cosineSimilarity(vec1, vec2) {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    const allKeys = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);

    allKeys.forEach(key => {
      const v1 = vec1[key] || 0;
      const v2 = vec2[key] || 0;
      dotProduct += v1 * v2;
      norm1 += v1 * v1;
      norm2 += v2 * v2;
    });

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  // Search for top N similar documents
  search(query, topN = 5) {
    const queryTokens = this.tokenize(query);
    const queryVector = this.getTFIDFVector(queryTokens);

    const results = this.documents.map(doc => {
      const docVector = this.getTFIDFVector(doc.tokens);
      const similarity = this.cosineSimilarity(queryVector, docVector);
      return {
        name: doc.name,
        content: doc.content,
        similarity: similarity
      };
    });

    // Sort by similarity (descending) and return top N
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN)
      .map(r => ({ ...r, similarity: Math.round(r.similarity * 100) / 100 }));
  }

  // Extract relevant snippets from a document based on query
  extractSnippet(content, query, snippetLength = 300) {
    const queryTokens = this.tokenize(query);
    const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);

    // Find sentence with most query term matches
    const scoredSentences = sentences.map((sent, idx) => {
      const sentTokens = this.tokenize(sent);
      const matches = queryTokens.filter(token => sentTokens.includes(token)).length;
      return { sentence: sent, score: matches, index: idx };
    });

    const bestSentence = scoredSentences.sort((a, b) => b.score - a.score)[0];
    if (!bestSentence || bestSentence.score === 0) {
      // Return first non-empty sentence as fallback
      return sentences[0] || content.substring(0, snippetLength);
    }

    return bestSentence.sentence;
  }
}

// Initialize corpus
const corpus = new DocumentCorpus();
const corpusPath = path.join(__dirname, 'corpus');
corpus.loadCorpus(corpusPath);

// ── AGENT CARD (A2A Discovery) ────────────────────────────────────────────────
const AGENT_BASE_URL = process.env.AGENT_BASE_URL || 'https://copilot-a2a.up.railway.app';

const agentCard = {
  name: "Incident Analysis Agent",
  description: "Searches a local repository of emails, call transcripts, and knowledge articles to find relevant context for incident resolution. Provide incident details and this agent returns the top 5 most similar documents with key excerpts that may help resolve the issue.",
  url: `${AGENT_BASE_URL}/a2a`,
  provider: {
    name: "ServiceNow A2A Incident Agent",
    url: AGENT_BASE_URL
  },
  version: "1.0.0",
  integration: "a2a", 
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false
  },
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  skills: [
    {
      id: "incident-analysis",
      name: "Incident Context Search",
      description: "Search knowledge base of emails, transcripts, and articles for similar incidents and relevant resolution context",
      examples: [
        "VPN connection dropping for employees",
        "Login page returning 500 error",
        "Database timeouts affecting order processing"
      ],
      inputModes: ["text"],
      outputModes: ["text"]
    }
  ]
};

// GET /.well-known/agent.json — required by A2A spec
app.get('/.well-known/agent.json', (req, res) => {
  res.json(agentCard);
});

// Also support the ServiceNow v1 path format
app.get('/.well-known/agent-card.json', (req, res) => {
  res.json(agentCard);
});

// ── A2A MESSAGE ENDPOINT ──────────────────────────────────────────────────────
// ServiceNow POSTs here to invoke the agent
app.post('/a2a', async (req, res) => {
  const { id, method, params } = req.body || {};

  // Handle jsonrpc envelope
  if (!method) {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32600, message: 'Invalid request: missing method' }
    });
  }

  if (method === 'message/send') {
    const message = params?.message;
    const parts = message?.parts || [];
    const textPart = parts.find(p => p.kind === 'text' || p.type === 'text');
    const query = textPart?.text || '';

    if (!query) {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          kind: 'task',
          id: `task-${Date.now()}`,
          contextId: message?.contextId || `ctx-${Date.now()}`,
          status: { state: 'completed', timestamp: new Date().toISOString() },
          artifacts: [{
            artifactId: `art-${Date.now()}`,
            name: 'response',
            parts: [{ kind: 'text', text: 'Please provide an incident description to search the knowledge base.' }]
          }]
        }
      });
    }

    try {
      // Search corpus for top 5 matching documents
      const results = corpus.search(query, 5);

      if (results.length === 0) {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            kind: 'task',
            id: `task-${Date.now()}`,
            contextId: message?.contextId || `ctx-${Date.now()}`,
            status: { state: 'completed', timestamp: new Date().toISOString() },
            artifacts: [{
              artifactId: `art-${Date.now()}`,
              name: 'incident_analysis_results',
              parts: [{ kind: 'text', text: 'No relevant documents found in the knowledge base.' }]
            }]
          }
        });
      }

      // Build response with citations
      let responseText = `INCIDENT ANALYSIS RESULTS\n`;
      responseText += `Query: ${query}\n`;
      responseText += `\nFound ${results.length} relevant documents:\n\n`;
      responseText += `─────────────────────────────────────────\n`;

      results.forEach((result, idx) => {
        const snippet = corpus.extractSnippet(result.content, query, 300);
        responseText += `\n${idx + 1}. SOURCE: ${result.name} (Match: ${(result.similarity * 100).toFixed(1)}%)\n`;
        responseText += `\nRELEVANT EXCERPT:\n`;
        responseText += `"${snippet}"\n`;
        responseText += `\n─────────────────────────────────────────\n`;
      });

      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          kind: 'task',
          id: `task-${Date.now()}`,
          contextId: message?.contextId || `ctx-${Date.now()}`,
          status: { state: 'completed', timestamp: new Date().toISOString() },
          artifacts: [{
            artifactId: `art-${Date.now()}`,
            name: 'incident_analysis_results',
            parts: [{ kind: 'text', text: responseText }]
          }]
        }
      });
    } catch (err) {
      console.error('Agent error:', err);
      return res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: `Agent error: ${err.message}` }
      });
    }
  }

  // tasks/get — return not found for unknown task IDs
  if (method === 'tasks/get') {
    return res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32001, message: 'Task not found (stateless agent)' }
    });
  }

  return res.json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  });
});

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    agent: agentCard.name,
    agentCard: `${AGENT_BASE_URL}/.well-known/agent.json`,
    a2aEndpoint: `${AGENT_BASE_URL}/a2a`,
    corpusDocuments: corpus.documents.length,
    version: agentCard.version
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Incident Analysis A2A Agent running on port ${PORT}`);
  console.log(`Agent Card: ${AGENT_BASE_URL}/.well-known/agent.json`);
  console.log(`Corpus loaded: ${corpus.documents.length} documents`);
});
