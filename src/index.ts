/* eslint-disable */
import "dotenv/config";
import {
  anthropic,
  createAgent,
  createNetwork,
  createTool,
} from "@inngest/agent-kit";
import { createServer } from "@inngest/agent-kit/server";
import { z } from "zod";

const apaiUrl = "http://localhost:9000/sse"

const APAIAgent = createAgent({
  name: "apai-agent",
  system: `You are a helpful assistant that help manage smart legal contracts using the APAI API. You can create templates and agreements based off templates and trigger the agreement clauses via functions exposed by the APAI API.
  IMPORTANT: Call the 'done' tool when the question is answered.
  `,
  tools: [
    createTool({
      name: "done",
      description: "Call this tool when you are finished with the task.",
      parameters: z.object({
        answer: z.string().describe("Answer to the user's question.")
      }),
      handler: async ({ answer }, { network }) => {
        if (network?.state.kv) {
          network.state.kv.set("answer", answer);
        }
      }
    })
  ],
  mcpServers: [
    {
      name: "apai",
      transport: {
        type: "sse",
        url: apaiUrl
      }
    }
  ]
});

const apaiAgentNetwork = createNetwork({
  name: "apai-agent",
  agents: [APAIAgent],
  defaultModel: anthropic({
    model: "claude-3-5-sonnet-20240620",
    defaultParameters: {
      max_tokens: 1000,
    },
  }),
  defaultRouter: ({ network }) => {
    if (!network?.state.kv.get("answer")) {
      return APAIAgent;
    }
    return;
  }
});

// Create and start the server
const server = createServer({
  networks: [apaiAgentNetwork]
});

server.listen(3010, () =>
  console.log("Support Agent demo server is running on port 3010")
);
