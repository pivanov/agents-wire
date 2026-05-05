import { render } from "ink";
import { App } from "@app/app";
import { resolveTheme } from "@app/theme/detect";
import { ThemeProvider } from "@app/theme/context";
import { saveStoredTheme } from "@app/theme/store";

const main = async (): Promise<void> => {
  if (!process.stdin.isTTY) {
    process.stderr.write("agents-wire playground requires an interactive terminal (TTY).\n");
    process.stderr.write("Run directly: bun run playground\n");
    process.exit(1);
  }

  const resolution = await resolveTheme();

  const { unmount, waitUntilExit } = render(
    <ThemeProvider initial={resolution.theme} onCommit={saveStoredTheme}>
      <App />
    </ThemeProvider>,
    {
      exitOnCtrlC: false,
      // Ink's default `patchConsole: true` injects a wrapper around
      // console.{log,warn,error} that writes "above" the dynamic frame
      // by emitting cursor-positioning ANSI of its own. Under Bun the
      // wrapper occasionally interleaves writes with Ink's own
      // log-update, leaving orphan frames stacked. We don't use
      // console.* at all, so the wrapper only adds risk.
      patchConsole: false,
    },
  );

  process.once("SIGTERM", () => unmount());
  process.once("SIGHUP", () => unmount());

  await waitUntilExit();
};

main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});
