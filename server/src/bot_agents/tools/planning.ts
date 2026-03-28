import type { AITool } from '../providers/baseProvider.js';
import {
  createPlan,
  updatePlanStep,
  getActivePlan,
  closeActivePlan,
  type StepStatus,
} from '../../memory/planTracker.js';

// ============================================================
// Tool: create_plan
// ============================================================
export const createPlanDeclaration: AITool = {
  name: 'create_plan',
  description: 'Create a persistent step-by-step plan for multi-step tasks.',
  parameters: {
    type: 'object',
    properties: {
      objective: {
        type: 'string',
        description: 'Main objective for this plan',
      },
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered list of concise steps',
      },
    },
    required: ['objective', 'steps'],
  },
};

async function createPlanToolForChat(
  chatId: string,
  { objective, steps }: { objective: string; steps: string[] }
): Promise<string> {
  if (!chatId) return 'Error: Missing chat context';

  if (!steps || steps.length === 0) {
    return 'Error: Plan must contain at least one step';
  }

  try {
    const plan = createPlan(chatId, objective, steps);

    if (!plan) {
      return 'Error: Failed to create plan.';
    }

    let output = `Plan created successfully.\nObjective: ${plan.objective}\nSteps:\n`;
    plan.steps.forEach((s) => {
      output += `  [ ] ${s.id}: ${s.description}\n`;
    });
    output += '\nUse update_plan_step to update progress.';

    return output;
  } catch (error) {
    return `Error: Failed to create plan due to an internal issue.`;
  }
}

// ============================================================
// Tool: update_plan_step
// ============================================================
export const updatePlanStepDeclaration: AITool = {
  name: 'update_plan_step',
  description: 'Update status of a step in the active plan.',
  parameters: {
    type: 'object',
    properties: {
      step_id: {
        type: 'string',
        description: 'Step ID (e.g. step-1)',
      },
      status: {
        type: 'string',
        description: 'One of: pending, in_progress, completed, failed',
      },
      result: {
        type: 'string',
        description: 'Optional short result or note',
      },
    },
    required: ['step_id', 'status'],
  },
};

async function updatePlanStepToolForChat(
  chatId: string,
  { step_id, status, result }: { step_id: string; status: StepStatus; result?: string }
): Promise<string> {
  if (!chatId) return 'Error: Missing chat context';

  const validStatuses = ['pending', 'in_progress', 'completed', 'failed'];
  if (!validStatuses.includes(status)) {
    return `Error: Invalid status. Allowed: ${validStatuses.join(', ')}`;
  }

  try {
    const plan = getActivePlan(chatId);
    if (!plan) {
      return 'Error: No active plan found for this chat';
    }

    const success = updatePlanStep(chatId, step_id, status, result);
    if (!success) {
      return `Error: Step not found: ${step_id}`;
    }

    const updatedPlan = getActivePlan(chatId);
    if (!updatedPlan) {
      return `Plan completed: ${plan.objective}`;
    }

    let output = `Updated ${step_id} to [${status}]\nCurrent plan:\n`;
    updatedPlan.steps.forEach((s) => {
      const icon = s.status === 'completed' ? '[x]' : s.status === 'in_progress' ? '[~]' : s.status === 'failed' ? '[!]' : '[ ]';
      output += `${icon} ${s.id}: ${s.description}\n`;
    });

    return output;
  } catch (error) {
    return `Error: Failed to update plan step due to an internal issue.`;
  }
}

// ============================================================
// Tool: close_plan
// ============================================================
export const closePlanDeclaration: AITool = {
  name: 'close_plan',
  description: 'Close the active plan immediately.',
  parameters: { type: 'object', properties: {} },
};

async function closePlanToolForChat(chatId: string): Promise<string> {
  if (!chatId) return 'Error: Missing chat context';

  try {
    const success = closeActivePlan(chatId, 'paused');
    if (success) {
      return 'Active plan closed.';
    }
    return 'No active plan found.';
  } catch (error) {
    return `Error: Failed to close plan due to an internal issue.`;
  }
}

// ============================================================
// Exports
// ============================================================

export const planningToolDeclarations: AITool[] = [
  createPlanDeclaration,
  updatePlanStepDeclaration,
  closePlanDeclaration,
];

export function getPlanningToolHandlers(chatId: string) {
  return {
    create_plan: (args: { objective: string; steps: string[] }) => createPlanToolForChat(chatId, args),
    update_plan_step: (args: { step_id: string; status: StepStatus; result?: string }) =>
      updatePlanStepToolForChat(chatId, args),
    close_plan: () => closePlanToolForChat(chatId),
  };
}
