import { spawn } from "node:child_process";

const processes = [
  {
    name: "client",
    cmd: "npm",
    args: ["--prefix", "packages/client", "run", "dev", "--", "--host"],
  },
  {
    name: "server",
    cmd: "npm",
    args: ["--prefix", "packages/server", "run", "dev"],
  },
  {
    name: "sandbox",
    cmd: "npm",
    args: ["--prefix", "packages/sandbox", "run", "dev"],
  },
];

const children = processes.map(({ name, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"] });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(1);
    }
  });

  return child;
});

let stopping = false;
function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 150);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
