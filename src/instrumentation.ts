/** Runs once when the server starts: connects the phone inbox's Discord bot when it is configured. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { discordConfig, startDiscordBot } = await import("@/lib/inbox/discord");
  if (discordConfig()) void startDiscordBot();
}
