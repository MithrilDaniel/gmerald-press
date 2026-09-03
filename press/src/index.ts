const job = process.argv[2] ?? 'press';

if (job === 'dry') process.env.PRESS_DRY_RUN = '1';

if (job === 'doctor') {
  const { runDoctor } = await import('./jobs/doctor.js');
  await runDoctor();
} else if (job === 'press' || job === 'dry') {
  const { runPress } = await import('./press.js');
  await runPress();
} else if (job === 'quotecheck') {
  const { runQuoteCheck } = await import('./jobs/quotecheck.js');
  await runQuoteCheck();
} else if (job === 'buys') {
  const { runBuys } = await import('./jobs/buys.js');
  await runBuys();
} else if (job === 'log') {
  const { runLog } = await import('./jobs/log.js');
  await runLog();
} else if (job === 'tgcheck') {
  const { runTgCheck } = await import('./jobs/tgcheck.js');
  await runTgCheck();
} else if (job === 'launchcheck') {
  const { runLaunchCheck } = await import('./jobs/launchcheck.js');
  await runLaunchCheck();
} else {
  console.error(`unknown job: ${job} (use press | dry | doctor | quotecheck | launchcheck | log | buys | tgcheck)`);
  process.exit(1);
}
