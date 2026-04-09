<<<<<<< HEAD
import { insertHtmlTool } from "@/wab/client/copilot/tools/insertHtml";
import { readTool } from "@/wab/client/copilot/tools/read";
import { CopilotTool } from "@/wab/shared/copilot/internal/copilot-tools";
=======
import { changeStylesTool } from "@/wab/client/copilot/tools/changeStyles";
import { deleteElementTool } from "@/wab/client/copilot/tools/deleteElement";
import { insertHtmlTool } from "@/wab/client/copilot/tools/insertHtml";
import { readTool } from "@/wab/client/copilot/tools/read";
import { CopilotTool } from "@/wab/shared/copilot/enterprise/copilot-tools";
>>>>>>> upstream/master

type AnyCopilotTool = CopilotTool<any>;

export const COPILOT_TOOLS: Record<string, AnyCopilotTool> = {
  [insertHtmlTool.toolName]: insertHtmlTool,
<<<<<<< HEAD
=======
  [changeStylesTool.toolName]: changeStylesTool,
  [deleteElementTool.toolName]: deleteElementTool,
>>>>>>> upstream/master
  [readTool.toolName]: readTool,
};
