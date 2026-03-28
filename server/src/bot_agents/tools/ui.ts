import type { AITool } from '../providers/baseProvider.js';
import { broadcast } from '../../utils/socketBroadcast.js';

export const renderUiDeclaration: AITool = {
  name: "render_ui",
  description: "Render a dynamic UI component (Generative UI) to the user's Dashboard screen.",
  parameters: {
    type: 'object',
    properties: {
      componentType: {
        type: 'string',
        description: "The type of component to render. Supported: 'card', 'bar_chart', 'data_table'",
      },
      title: {
        type: 'string',
        description: "The title of the UI component",
      },
      data: {
        type: 'string',
        description: "A JSON string containing the data for the component. For 'card', use { content: string, color?: string }. For 'data_table', use { headers: string[], rows: string[][] }",
      },
    },
    required: ["componentType", "title", "data"],
  },
};

export const getUiToolHandlers = (chatId?: string) => {
  return {
    render_ui: async (args: any) => {
      const componentType = args.componentType;
      const title = args.title;
      const dataStr = args.data;

      try {
        const data = JSON.parse(dataStr);
        // Broadcast to specific chat session or globally if not specified
        broadcast('agent:ui', {
            chatId,
            componentType,
            title,
            data,
            timestamp: new Date().toISOString()
        });
        return `✅ Rendered ${componentType} UI successfully on the Dashboard.`;
      } catch (err: any) {
        return `❌ Failed to render UI. Invalid data JSON format: ${err.message}`;
      }
    }
  };
};

export const uiToolDeclarations = [
  renderUiDeclaration,
];
