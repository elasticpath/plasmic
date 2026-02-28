module.exports = {
  apps: [
    {
      name: "plasmic-wab",
      script: "src/wab/server/main.ts",
      interpreter: "node",
      interpreter_args: "-r esbuild-register",
      instances: 1,
      wait_ready: true,
      listen_timeout: 19999,
      kill_timeout: 7999,
      autorestart: true,
      max_memory_restart: "2G",
      exp_backoff_restart_delay: 100,
    },
  ],
};
