// Child-process entry for the onboarding live scan. gatherStats() parses
// every local session store — seconds of synchronous work — so it runs here,
// off the UI loop, and reports back as JSON on stdout.

import { gatherStats } from "./onboarding.ts";

process.stdout.write(JSON.stringify(gatherStats()));
