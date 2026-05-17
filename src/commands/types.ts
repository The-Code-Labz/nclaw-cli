// Slash-command context + interface. Used by the registry to wire commands
// into the App without hard-coding string compares in InputBar.

export interface CommandContext {
  submit:        (text: string) => void;
  clearScreen:   () => void;
  openAgentPick: () => void;
  exit:          () => void;
  retryLast:     () => void;
  newSession:    () => void;
  setCwdDisplay: (cwd: string) => void;
  getLastAgentMessage: () => string | null;
  /** Append a synthetic system message to the transcript. */
  emitSystem:    (text: string) => void;
}

export type CommandCategory = 'session' | 'agent' | 'system' | 'help';

export interface Command {
  name:        string;             // canonical, e.g. "clear"
  slash:       string;             // "/clear"
  aliases?:    string[];           // ["/cls"]
  description: string;
  category:    CommandCategory;
  run:         (ctx: CommandContext, args: string[]) => void | Promise<void>;
}
