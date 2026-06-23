# Incident Analysis A2A Agent

A ServiceNow Agent-to-Agent (A2A) copilot that searches a local corpus of emails, call transcripts, and knowledge articles to find relevant context for incident resolution.

## Setup

1. **Clone/navigate to your GitHub repo**
   ```bash
   git clone https://github.com/michellefoley0728/CopilotA2A.git
   cd CopilotA2A
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Add corpus files**
   - Create a `/corpus` folder in the root directory
   - Add your text files:
     - `email_1.txt`
     - `email_2.txt`
     - `call_transcript.txt`
     - `knowledge_article.txt`
   - The agent will automatically load and index all `.txt` files on startup

4. **Test locally**
   ```bash
   npm start
   ```
   - Agent runs on `http://localhost:3000`
   - Check health: `curl http://localhost:3000`
   - Agent card: `curl http://localhost:3000/.well-known/agent.json`

5. **Deploy to Railway**
   - Push code to GitHub main branch
   - Railway auto-detects and deploys
   - Once deployed, get your Railway domain URL
   - Update the `AGENT_BASE_URL` in the agent card (or use Railway's environment variables)

6. **Register in ServiceNow**
   - Go to ServiceNow → AI Agents
   - Add new agent
   - Agent Card URL: `https://YOUR-RAILWAY-DOMAIN.up.railway.app/.well-known/agent.json`
   - Agent will be callable via A2A in incident resolution workflows

## How It Works

1. **Corpus Loading**: On startup, all `.txt` files in `/corpus` are loaded and tokenized
2. **Search**: When an incident is sent via A2A, the agent:
   - Tokenizes the incident description
   - Computes TF-IDF vectors for the incident and all corpus documents
   - Finds top 5 most similar documents using cosine similarity
   - Extracts relevant snippets from each document
3. **Response**: Returns structured JSON with:
   - Document name (citation)
   - Similarity score
   - Relevant excerpt

## Corpus File Format

Each `.txt` file should be plain text. Examples:
- **Emails**: Include sender, date, subject, and body
- **Call Transcripts**: Format as dialogue with timestamps
- **Knowledge Articles**: Title, sections, and content

The agent extracts relevant sentences automatically based on query terms.

## Architecture

- **Express.js**: A2A endpoint
- **TF-IDF + Cosine Similarity**: Local document matching (no external APIs)
- **In-memory**: Corpus loaded on startup, no database needed

## Environment Variables

- `PORT`: Server port (default: 3000)
- `AGENT_BASE_URL`: Base URL for agent card (set by Railway or override)

## Example A2A Call

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "contextId": "ctx-123",
      "parts": [
        {
          "kind": "text",
          "text": "VPN connection dropping for employees in Building C"
        }
      ]
    }
  }
}
```

## Response

The agent returns the top 5 matching documents with:
- Document name (filename)
- Similarity score (0-1)
- Relevant excerpt from that document

This context helps incident responders quickly find relevant history, similar issues, and resolution steps.
