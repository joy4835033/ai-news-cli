import cron from 'node-cron';

export interface SchedulerOptions {
  expression?:     string;
  timezone?:       string;
  runImmediately?: boolean;
}

export function startScheduler(
  task: () => Promise<void>,
  options: SchedulerOptions = {}
): void {
  const {
    expression     = '0 8 * * *',
    timezone       = 'Asia/Shanghai',
    runImmediately = false,
  } = options;

  if (!cron.validate(expression)) {
    throw new Error(`❌ 无效的 cron 表达式：${expression}`);
  }

  console.log('⏰ 定时模式已启动');
  console.log(`   📅 执行计划：${expression}  (${timezone})`);
  console.log(`   🕗 下次执行：每天 08:00\n`);

  cron.schedule(expression, async () => {
    console.log(`\n🔔 [${formatNow()}] 定时任务触发，开始执行...\n`);
    try {
      await task();
      console.log(`✅ [${formatNow()}] 本次执行完成，等待下次调度\n`);
    } catch (err) {
      console.error(`❌ [${formatNow()}] 本次执行失败：`, err);
    }
  }, { timezone });

  if (runImmediately) {
    console.log('🚀 检测到 --now 标志，立即执行一次...\n');
    task().catch(err => console.error('❌ 立即执行失败：', err));
  }

  keepAlive();
}

function formatNow(): string {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function keepAlive(): void {
  const timer = setInterval(() => {}, 1 << 30);
  process.on('SIGINT', () => {
    console.log('\n\n👋 收到退出信号，定时任务已停止。');
    clearInterval(timer);
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    clearInterval(timer);
    process.exit(0);
  });
}
