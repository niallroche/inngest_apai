# APAI Agent with Inngest

This AgentKit Agent relies on the [Accord Project MCP Server implementation](https://github.com/accordproject/apap) which provides a standardized interface for agents to interact with the APAI (Agreement Processing AI) system. Also see the [Accord Project MCP Server proof of concept](https://github.com/The-Building-Blocks/accord-project-mcp) for experimental features and a STDIO implementation rather than SSE. The MCP Server enables agents to communicate with smart legal contracts and execute tasks such as:

- Fetching and analyzing smart legal contract data
- Processing agreement terms and conditions
- Extracting key information from legal documents
- Generating summaries and insights from contract data

## Architecture

- **Tools**:
  - `apai-getAgreement`: MCP tool that interfaces with Accord's APAI to fetch and process smart legal contract data
  - `done`: Signals completion and returns the final answer

- **Agent**: Uses Claude 3.5 Sonnet to process smart legal contracts and make MCP tool calls

- **Network**: Manages the agent's execution and state, including MCP communication

- **Server**: Exposes an HTTP endpoint at `http://localhost:3010` that accepts requests and returns answers

## MCP Integration

The agent connects to Accord's APAI interface using MCP over SSE (Server-Sent Events) at `http://localhost:9000/sse`. This allows for:
- Real-time communication with smart legal contracts
- Standardized message passing between the agent and APAI
- Seamless integration with Accord's contract processing system

## Prerequisites

- Node.js (v16 or later)
- npm or yarn
- An Anthropic API key for Claude
- Access to Accord's APAI system

## Development

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with your API keys:
```
ANTHROPIC_API_KEY=your_anthropic_api_key
```

3. Start the server:
```bash
npm start
```

4. Start the Inngest Dev Server:
```bash
npx inngest-cli@latest dev
```

You can now access the Inngest DevServer at [http://127.0.0.1:8288/functions](http://127.0.0.1:8288/functions)

## Usage

Send a POST request to the server with either:
- `input`: A text prompt
- `agreementId`: A smart legal contract ID to process

Example:
```bash
curl -X POST http://localhost:3010/penalties \
  -H "Content-Type: application/json" \
  -d '{"agreementId": "123"}'
```

Or use the Inngest DevServer to invoke the function with:
```json
{
  "data": {
    "input": "Analyze the terms and conditions in agreement 123"
  }
}
```

## License

MIT 