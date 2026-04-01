import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import { type SessionID, MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"

async function getLastModel(sessionID: SessionID) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({
    agent: z.string().optional().default("main"),
  }),
  async execute(params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Plan at ${plan} is complete. Would you like to start building?`,
          header: "Start Building",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to the main agent and start implementing the plan" },
            { label: "No", description: "Stay in plan mode to continue refining the plan" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    const targetAgent = params.agent ?? "main"
    const userMsg: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: targetAgent,
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `The plan at ${plan} has been approved. Execute the plan`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to main agent",
      output: "User approved the plan. Wait for further instructions.",
      metadata: {},
    }
  },
})

export const PlanEnterTool = Tool.define("plan_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({
    agent: z.string().optional().default("startup-agent"),
  }),
  async execute(params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))

    const targetAgent = params.agent ?? "startup-agent"
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to switch to planning mode?`,
          header: "Plan Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to planning agent" },
            { label: "No", description: "Stay here and continue" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: targetAgent,
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `User has requested planning mode. The plan file will be at ${plan}. Begin the discovery conversation.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: `Switching to ${targetAgent}`,
      output: `User confirmed planning mode. A new message has been created. The plan file will be at ${plan}.`,
      metadata: {},
    }
  },
})
