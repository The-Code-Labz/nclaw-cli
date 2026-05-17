import readline from 'readline';

export type ConfirmResult = 'yes' | 'always' | 'no';

export function askConfirm(question: string, rl: readline.Interface): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === 'a') resolve('always');
      else if (a === 'y') resolve('yes');
      else resolve('no');
    });
  });
}
