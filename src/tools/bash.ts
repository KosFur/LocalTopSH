/**
 * run_command - Execute shell commands
 * Pattern: Action (run) + Object (command)
 * Security: Dangerous commands require user approval
 */

import { execSync } from 'child_process';
import { checkCommand, requestApproval } from '../approvals/index.js';

// Callback for requesting approval from user
let approvalCallback: ((
  sessionId: string,
  command: string,
  reason: string
) => Promise<boolean>) | null = null;

/**
 * Set the approval callback (called from bot)
 */
export function setApprovalCallback(
  callback: (sessionId: string, command: string, reason: string) => Promise<boolean>
) {
  approvalCallback = callback;
}

export const definition = {
  type: "function" as const,
  function: {
    name: "run_command",
    description: "Run a shell command. Use for: git, npm, pip, system operations. DANGEROUS commands (rm -rf, sudo, etc.) require user approval.",
    parameters: {
      type: "object",
      properties: {
        command: { 
          type: "string", 
          description: "The shell command to execute" 
        },
      },
      required: ["command"],
    },
  },
};

export interface ExecuteContext {
  cwd: string;
  sessionId?: string;
}

export async function execute(
  args: { command: string },
  cwd: string | ExecuteContext
): Promise<{ success: boolean; output?: string; error?: string; approval_required?: boolean }> {
  // Handle both old (string) and new (object) signatures
  const context: ExecuteContext = typeof cwd === 'string' ? { cwd } : cwd;
  const workDir = context.cwd;
  const sessionId = context.sessionId || 'default';
  
  // Check if command is dangerous
  const { dangerous, reason } = checkCommand(args.command);
  
  if (dangerous) {
    console.log(`[SECURITY] Dangerous command detected: ${args.command}`);
    console.log(`[SECURITY] Reason: ${reason}`);
    
    // If no approval callback, deny by default
    if (!approvalCallback) {
      return {
        success: false,
        error: `⚠️ BLOCKED: This command requires approval (${reason}) but no approval mechanism is configured.`,
        approval_required: true,
      };
    }
    
    // Request approval from user
    const approved = await approvalCallback(sessionId, args.command, reason!);
    
    if (!approved) {
      return {
        success: false,
        error: `❌ Command denied by user. Reason flagged: ${reason}`,
        approval_required: true,
      };
    }
    
    console.log(`[SECURITY] Command approved by user`);
  }
  
  // Execute the command
  try {
    const output = execSync(args.command, {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 180000, // 3 min
      maxBuffer: 1024 * 1024 * 10,
    });
    
    // Limit output to prevent context overflow
    const trimmed = output.length > 10000 
      ? output.slice(0, 5000) + '\n...(truncated)...\n' + output.slice(-3000)
      : output;
    
    return { success: true, output: trimmed || "(empty output)" };
  } catch (e: any) {
    const stderr = e.stderr?.toString() || '';
    const stdout = e.stdout?.toString() || '';
    const full = stderr || stdout || e.message;
    
    // Truncate error output too
    const trimmed = full.length > 5000 
      ? full.slice(0, 2500) + '\n...(truncated)...\n' + full.slice(-2000)
      : full;
    
    return { 
      success: false, 
      error: `Exit ${e.status || 1}: ${trimmed}`
    };
  }
}
