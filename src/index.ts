// src/index.ts
import "dotenv/config";
import {
  anthropic,
  createAgent,
  createNetwork,
  createTool
} from "@inngest/agent-kit";
import { createServer } from "@inngest/agent-kit/server";
import { Inngest } from "inngest";
import { z } from "zod";

// 1) Tools
const getAgreementTool = createTool({
  name:        "apai-getAgreement",
  description: "Fetch agreement by ID",
  parameters:  z.object({ agreementId: z.string() }),
  handler:     async ({ agreementId }) => {
    console.log("→ getAgreementTool called for:", agreementId);
    return { success: true };
  }
});

const doneTool = createTool({
  name:        "done",
  description: "Finish the task with an answer",
  parameters:  z.object({ answer: z.string() }),
  handler:     async ({ answer }, { network }) => {
    console.log("→ doneTool called with:", answer);
    network?.state.kv?.set("answer", answer);
    return answer;
  }
});

// 2) Agent & Network
const agent = createAgent({
  name:       "apai-agent",
  system:     "Use apai-getAgreement to fetch the agreement, then call done(answer).",
  tools:      [getAgreementTool, doneTool],
  mcpServers: [
    { name: "apai", transport: { type: "sse", url: "http://localhost:9000/sse" } }
  ]
});

const network = createNetwork({
  name:         "apai-network",
  agents:       [agent],
  defaultModel: anthropic({
    model:             "claude-3-5-sonnet-20240620",
    defaultParameters: { max_tokens: 1000 }
  })
});

// 3) Client‐based function (v0.8 style)
const client = new Inngest({ id: "apai-agent-network" });
export const apaiAgentFunction = client.createFunction(
  {
    id:          "apai-agent",   // must match fnId in your curl body
    name:        "APAI Agent",
    retries:     0,
    concurrency: 1,
  },
  { event: "apai/request" },
  async ({ event }) => {
    const prompt = event.data.input;
    console.log("🔔 Invoked with:", prompt);

    // Inline router: before each turn, check for answer in state.kv
    const runResult = await network.run(prompt, {
      router: ({ network }) => {
        if (network.state.kv?.get("answer")) {
          console.log("🔴 router: answer found → stopping run()");
          return;        // undefined => stop the loop
        }
        return agent;    // otherwise keep invoking the agent
      }
    });

    const answer = runResult.state.kv?.get("answer");
    console.log("✅ Returning answer:", answer);
    return { answer };
  }
);

// 4) Mount the HTTP server
const server = createServer({
  networks:  [network],
  appId:     "apai-agent-network",
  functions: [apaiAgentFunction as any]
});

server.listen(3010, () => {
  console.log("🚀 Listening on http://localhost:3010");
});