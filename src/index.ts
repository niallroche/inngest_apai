import "dotenv/config";
import { anthropic, createAgent, createNetwork, createTool } from "@inngest/agent-kit";
import { createServer } from "@inngest/agent-kit/server";
import { Inngest } from "inngest";
import { z } from "zod";
import { type ToolCallMessage } from "@inngest/agent-kit";
// import express from "express";

const apaiUrl = "http://localhost:9000/sse";

const getAgreementTool = createTool({
  name: "apai-getAgreement",
  description: "Retrieves the full data of an agreement",
  parameters: z.object({
    agreementId: z.string().describe("ID of the agreement to fetch"),
  }),
  mcp: {
    server: {
      name: "apai",
      transport: { type: "sse" as const, url: apaiUrl },
    },
    tool: { name: "getAgreement" },
  },
  handler: async (_args) => {
    // no-op stub; the MCP server will actually handle the call
    return { success: true };
  },
});

const getTemplateTool = createTool({
  name: "apai-getTemplate",
  description: "Retrieves the full data of a template",
  parameters: z.object({
    templateId: z.string().describe("ID of the template to fetch"),
  }),
  mcp: {
    server: {
      name: "apai",
      transport: { type: "sse" as const, url: apaiUrl },
    },
    tool: { name: "getTemplate" },
  },
  handler: async (_args) => {
    // no-op stub
    return { success: true };
  },
});

const done = createTool({
  name: "done",
  description: "Finish the task",
  parameters: z.object({ answer: z.string() }),
  handler: async ({ answer }, { network }) => {
    network?.state.kv?.set("answer", answer);
    return answer;
  }
});

const agent = createAgent({
  name: "apai-agent",
  system: `
You're an assistant that uses apai-getAgreement to fetch an agreement, then calls done with your answer.
`,
  tools: [getAgreementTool, getTemplateTool, done],
  mcpServers: [{ name: "apai", transport: { type: "sse", url: apaiUrl } }]
});

const apaiAgentNetwork = createNetwork({
  name: "apai-network",
  agents: [agent],
  defaultModel: anthropic({ model: "claude-3-5-sonnet-20240620", defaultParameters: { max_tokens: 1000 } })
});

// This wires up a Cloud function that the Console will invoke:
const inngestClient = new Inngest({ id: "apai-agent-network" });
export const apaiAgentFunction = inngestClient.createFunction(
  {  
    id: "apai-agent",         // this must match the Console function ID
    name: "APAI Agent",
    retries: 0,
    concurrency: 1
  },
  { event: "apai/request" },
  async ({ event }) => {
    console.log("apaiAgentFunction invoked with:", event.data.input);
    const networkRun = await apaiAgentNetwork.run(event.data.input);
    const inference = networkRun.state.results[networkRun.state.results.length - 1];
    console.log("🦾 Agent output:", inference.output);
    // Find the `done` tool_call in the final output
    const doneCall = inference.output?.find(
      m => m.type === "tool_call" && m.tools?.[0]?.name === "done"
    ) as ToolCallMessage | undefined;
    if (doneCall) {
      console.log("✅ Done call answer:", doneCall.tools[0].input.answer);
      // Unwrap and return just the answer string
      return { answer: doneCall.tools[0].input.answer };
    }

    // Fallback: return whatever text the agent emitted
    const texts = inference.output
      ?.filter(m => m.type === "text")
      .map(m => m.content)
      .join("\n");
    return { answer: texts || "No answer generated." };
    // console.log("🦾 Agent output:", lastResult?.output);
    // console.log("All done:", lastResult?.output);
    // return lastResult;
  }
);


// Create a bare express app to capture all routes:
// const app = express();
// app.use(express.json());  // parse JSON bodies
// app.use((req, res, next) => {
//   console.log("🔔 Received HTTP request:", req.method, req.originalUrl);
//   next();
// });

const server = createServer({
  
  networks: [apaiAgentNetwork],
  appId: "apai-agent-network",
  functions:  [apaiAgentFunction]
});

server.listen(3010, () => console.log("Listening on :3010"));