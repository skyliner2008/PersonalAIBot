import * as pty from 'node-pty';
import os from 'os';

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

try {
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: process.cwd(),
    env: process.env
  });

  ptyProcess.onData((data) => {
    console.log('Data: ' + data);
    process.exit(0);
  });

  ptyProcess.write('ls\r');
} catch (e) {
  console.error(e);
  process.exit(1);
}
