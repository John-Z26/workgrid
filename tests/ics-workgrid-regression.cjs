// ICS课表转WorkGrid导入助手 —— 自动化测试
// 覆盖：恶意SUMMARY(XSS)、重复导入零新增、COUNT、INTERVAL、BYDAY、多值EXDATE、
//       多个EXDATE、TZID、全天事件、RECURRENCE-ID、重复ID检测、窗口（学期中途）、UNTIL、真实课表回归
// 运行：node test_ics_converter.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const DIR = __dirname;
const RRuleMod = require(path.join(DIR, "rrule.min.cjs"));
// UMD 在 CommonJS 下导出 { RRule, RRuleSet, ... }，取构造函数；浏览器 <script> 下全局 RRule 即构造函数
const RRule = RRuleMod.RRule || RRuleMod;

const html = fs.readFileSync(
  process.env.ICS_HTML_PATH || path.join(DIR, "..", "public", "ics-workgrid.html"),
  "utf8"
);
const core = html.split("/* ===== ICS 解析器 ===== */")[1].split("/* JS: CONVERT_END */")[0];

const ctx = vm.createContext({
  RRule, console,
  Math, Date, Intl, Set, Map, String, Number, Array, RegExp, JSON, Object, Error, Symbol,
  isNaN, parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
});
vm.runInContext(`"use strict";
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const COLORS = ["red","orange","yellow","green","blue","indigo","purple"];
const COLOR_LABEL = { red:"红", orange:"橙", yellow:"黄", green:"绿", blue:"蓝", indigo:"靛", purple:"紫" };
`, ctx);
vm.runInContext(core, ctx);

// 核心函数（function 声明挂在 context 全局）
const {
  unfoldICS, extractEvents, parseICSDate, dtToMs,
  expandOccurrences, parseExdates, collectRecIdMs, stableHash, esc,
  eventToBlocks, buildBackup, validateBlocks,
} = ctx;

const DAY = 864e5;
const RANGE_START = Date.UTC(2026, 9, 9, 0, 0);   // 窗口起点 2026-10-09 00:00 UTC
const RANGE_END = RANGE_START + 42 * DAY - 1;      // 42 天窗口 2026-11-19 23:59:59 UTC

function opts(over) {
  return Object.assign({
    maxDays: 42, rangeStart: RANGE_START, rangeEnd: RANGE_END,
    allDayH: 9, allDayM: 0, allDayDur: 480,
    colorMode: "title", tagMode: "none", titleSuffix: "none",
  }, over || {});
}

function conv(ics, over) {
  const lines = unfoldICS(ics);
  const events = extractEvents(lines);
  const o = opts(over);
  const recIdMap = collectRecIdMs(events);
  return events.flatMap(ev => eventToBlocks(ev, o, recIdMap));
}

function vcal(eventsTxt) {
  return "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n" + eventsTxt + "\nEND:VCALENDAR";
}
function vev(lines) {
  return "BEGIN:VEVENT\n" + lines.join("\n") + "\nEND:VEVENT";
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + "\n      " + e.message); }
}

/* ========== 1. 恶意 SUMMARY / XSS ========== */
test("恶意 SUMMARY 不会逃出 HTML 属性（XSS 修复）", () => {
  const ics = vcal(vev([
    "UID:xss-1",
    "DTSTART;TZID=Asia/Shanghai:20261012T080000",
    "DTEND;TZID=Asia/Shanghai:20261012T094000",
    'SUMMARY:x" onmouseenter="alert(1)',
  ]));
  const blocks = conv(ics);
  assert.equal(blocks.length, 1);
  // 属性拼接必须经过 esc：结果里不允许出现可执行的裸引号注入
  const attr = `title="${esc(blocks[0].title)}"`;
  assert.ok(!attr.includes('onmouseenter="'), "转义后不应含可执行属性注入");
  assert.ok(attr.includes("&quot; onmouseenter=&quot;"), "双引号应被转义为实体");
  // 文本节点同样安全
  assert.ok(!esc(blocks[0].title).includes('onmouseenter="'));
});

test("恶意 SUMMARY 含 <script> 时文本转义", () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

/* ========== 2. 重复导入零新增 ========== */
test("同一 ICS 连续转换两次 → 任务 id/createdAt 完全一致 → 合并零新增", () => {
  const ics = vcal(vev([
    "UID:dup-1",
    "DTSTART;TZID=Asia/Shanghai:20261012T080000",
    "DTEND;TZID=Asia/Shanghai:20261012T094000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
    "SUMMARY:高数",
    "DTSTAMP:20260901T010203Z",
  ]));
  const b1 = conv(ics), b2 = conv(ics);
  assert.ok(b1.length >= 6);
  const k1 = b1.map(x => x.id + "|" + x.createdAt);
  const k2 = b2.map(x => x.id + "|" + x.createdAt);
  assert.deepStrictEqual(k1, k2, "两次转换的 id 与 createdAt 必须逐项一致");
  // 模拟 WorkGrid 合并导入去重：第二次新增为 0
  const seen = new Set(b1.map(x => x.id));
  const added = b2.filter(x => !seen.has(x.id));
  assert.equal(added.length, 0);
});

test("无 DTSTAMP 时 createdAt 由事件开始时间确定", () => {
  const ics = vcal(vev([
    "UID:no-dtstamp",
    "DTSTART;TZID=Asia/Shanghai:20261012T080000",
    "DTEND;TZID=Asia/Shanghai:20261012T094000",
    "SUMMARY:无时间戳课",
  ]));
  const b1 = conv(ics), b2 = conv(ics);
  assert.equal(b1[0].createdAt, b2[0].createdAt);
  assert.equal(b1[0].createdAt, new Date(b1[0].start).toISOString());
});

/* ========== 3. RRULE COUNT ========== */
test("COUNT=2 的 WEEKLY+BYDAY=MO,WE 恰好产生 2 个 occurrence（无重复）", () => {
  const ics = vcal(vev([
    "UID:count-1",
    "DTSTART;TZID=Asia/Shanghai:20261012T080000", // 周一
    "DTEND;TZID=Asia/Shanghai:20261012T094000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=2",
    "SUMMARY:计数课",
  ]));
  const blocks = conv(ics);
  assert.equal(blocks.length, 2, "应为恰好 2 节");
  const starts = blocks.map(b => new Date(b.start).toISOString().slice(0, 10));
  // 注意：blocks 来自 vm 沙盒，其数组原型与 Node 不同；展开为 Node 数组后再做严格深比较
  assert.deepStrictEqual([...starts], ["2026-10-12", "2026-10-14"], "应为周一与周三各一次");
});

/* ========== 4. INTERVAL ========== */
test("INTERVAL=2 隔周展开", () => {
  const ics = vcal(vev([
    "UID:int-1",
    "DTSTART;TZID=Asia/Shanghai:20261012T080000",
    "DTEND;TZID=Asia/Shanghai:20261012T094000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO;INTERVAL=2",
    "SUMMARY:隔周课",
  ]));
  const blocks = conv(ics);
  assert.ok(blocks.length >= 3, "42 天窗口应含 4 次，至少 3");
  const days = blocks.map(b => new Date(b.start).getTime());
  for (let i = 1; i < days.length; i++) {
    assert.equal((days[i] - days[i - 1]) / DAY, 14, "相邻 occurrence 应相隔 14 天");
  }
});

/* ========== 5. BYDAY 周几 ========== */
test("BYDAY=MO,WE 输出的 occurrence 都在周一/周三", () => {
  const ics = vcal(vev([
    "UID:wd-1",
    "DTSTART;TZID=Asia/Shanghai:20261012T080000",
    "DTEND;TZID=Asia/Shanghai:20261012T094000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
    "SUMMARY:按天课",
  ]));
  const blocks = conv(ics);
  assert.ok(blocks.length >= 10, "42 天窗口每周 2 次，应 ≥ 10");
  for (const b of blocks) {
    const wd = new Date(b.start).getUTCDay();
    assert.ok(wd === 1 || wd === 3, "只能落在周一(1)或周三(3)，实际 " + wd);
  }
});

/* ========== 6. 多值 EXDATE ========== */
test("多值 EXDATE（逗号分隔两个日期）全部排除", () => {
  const ics = vcal(vev([
    "UID:ex1-1",
    "DTSTART;TZID=Asia/Shanghai:20261012T080000",
    "DTEND;TZID=Asia/Shanghai:20261012T094000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
    "SUMMARY:停课课",
    "EXDATE;TZID=Asia/Shanghai:20261012T080000,20261014T080000",
  ]));
  const blocks = conv(ics);
  const dates = blocks.map(b => new Date(b.start).toISOString().slice(0, 10));
  assert.ok(!dates.includes("2026-10-12"), "第一个 EXDATE 应被排除");
  assert.ok(!dates.includes("2026-10-14"), "第二个 EXDATE 应被排除");
  assert.ok(dates.includes("2026-10-19"), "下一周仍正常生成");
});

/* ========== 7. 多个 EXDATE 属性 ========== */
test("多个 EXDATE 属性行都生效", () => {
  const ics = vcal(vev([
    "UID:ex2-1",
    "DTSTART;TZID=Asia/Shanghai:20261012T080000",
    "DTEND;TZID=Asia/Shanghai:20261012T094000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "SUMMARY:多行停课",
    "EXDATE;TZID=Asia/Shanghai:20261012T080000",
    "EXDATE;TZID=Asia/Shanghai:20261026T080000",
  ]));
  const blocks = conv(ics);
  const dates = blocks.map(b => new Date(b.start).toISOString().slice(0, 10));
  assert.ok(!dates.includes("2026-10-12") && !dates.includes("2026-10-26"));
  assert.ok(dates.includes("2026-10-19"), "未被排除的日期正常生成");
});

/* ========== 8. TZID 时区 ========== */
test("TZID=Asia/Shanghai 时刻正确折算（UTC-8h）", () => {
  const ics = vcal(vev([
    "UID:tz-1",
    "DTSTART;TZID=Asia/Shanghai:20261012T080000",
    "DTEND;TZID=Asia/Shanghai:20261012T094000",
    "SUMMARY:时区课",
  ]));
  const blocks = conv(ics);
  assert.equal(blocks[0].start, "2026-10-12T00:00:00.000Z", "上海 08:00 = UTC 00:00");
  assert.equal(blocks[0].duration, 100);
});

test("UTC(Z) 时刻直接保留", () => {
  const ics = vcal(vev([
    "UID:utc-1",
    "DTSTART:20261012T080000Z",
    "DTEND:20261012T094000Z",
    "SUMMARY:UTC课",
  ]));
  const blocks = conv(ics);
  assert.equal(blocks[0].start, "2026-10-12T08:00:00.000Z");
});

/* ========== 9. 全天事件 ========== */
test("全天事件(DATE)应用用户设定钟点与时长", () => {
  const ics = vcal(vev([
    "UID:allday-1",
    "DTSTART;VALUE=DATE:20261012",
    "DTEND;VALUE=DATE:20261013",
    "SUMMARY:全天课",
  ]));
  const blocks = conv(ics, { allDayH: 9, allDayM: 30, allDayDur: 180 });
  assert.equal(blocks.length, 1);
  const d = new Date(blocks[0].start);
  assert.equal(d.getHours(), 9, "全天课开始小时=9");
  assert.equal(d.getMinutes(), 30, "全天课开始分钟=30");
  assert.equal(blocks[0].duration, 180, "全天课时长=180 分钟");
});

/* ========== 10. RECURRENCE-ID 覆盖 ========== */
test("RECURRENCE-ID 覆盖：主序列剔除被覆盖时刻，覆盖事件单独输出", () => {
  const ics = vcal(
    vev([
      "UID:rec-1",
      "DTSTART;TZID=Asia/Shanghai:20261012T080000",
      "DTEND;TZID=Asia/Shanghai:20261012T094000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
      "SUMMARY:主课",
    ]) + "\n" +
    vev([
      "UID:rec-1",
      "RECURRENCE-ID;TZID=Asia/Shanghai:20261014T080000",
      "DTSTART;TZID=Asia/Shanghai:20261014T100000",
      "DTEND;TZID=Asia/Shanghai:20261014T114000",
      "SUMMARY:调课",
    ])
  );
  const blocks = conv(ics);
  const byStart = {};
  for (const b of blocks) byStart[b.start.slice(0, 16)] = b.title;
  assert.ok(byStart["2026-10-12T00:00"] === "主课", "主课 10/12 保留");
  assert.ok(byStart["2026-10-14T02:00"] === "调课", "覆盖事件 10/14 10:00(UTC02:00) 单独输出为调课");
  assert.ok(!("2026-10-14T00:00" in byStart), "主序列 10/14 08:00 不得重复出现");
  assert.ok(!blocks.some(b => b.title === "主课" && b.start.slice(0, 10) === "2026-10-14"), "主课不得出现在被覆盖日");
});

/* ========== 11. 重复 ID 检测 ========== */
test("validateBlocks 检测重复 id（整包拒绝前拦截）", () => {
  const base = {
    title: "课", color: "blue", duration: 60, start: "2026-10-12T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z", status: "todo", completedAt: null,
    reminderMinutes: null, remindedAt: null, endReminder: false, endRemindedAt: null,
    tags: [], deletedAt: null, seriesId: null, recurrence: null,
  };
  const { ok, bad } = validateBlocks([{ ...base, id: "dup" }, { ...base, id: "dup" }]);
  assert.equal(ok.length, 1);
  assert.equal(bad.length, 1);
  assert.ok(bad[0].problems.includes("id 重复"));
});

test("stableHash 稳定且极少碰撞", () => {
  assert.equal(stableHash("a|123"), stableHash("a|123"));
  assert.notEqual(stableHash("a|123"), stableHash("a|124"));
  const n = 5000;
  const s = new Set();
  for (let i = 0; i < n; i++) s.add(stableHash("u" + i + "|" + (i * 7)));
  assert.equal(s.size, n, "5000 个不同输入不应碰撞");
});

/* ========== 12. 窗口（学期中途导入） ========== */
test("窗口：DTSTART 在过去，只输出窗口内未来课程", () => {
  const ics = vcal(vev([
    "UID:win-1",
    "DTSTART;TZID=Asia/Shanghai:20260901T080000", // 学期开始（窗口之前）
    "DTEND;TZID=Asia/Shanghai:20260901T094000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "SUMMARY:学期课",
  ]));
  const blocks = conv(ics);
  assert.ok(blocks.length > 0, "窗口内应仍有未来课程");
  for (const b of blocks) {
    const t = Date.parse(b.start);
    assert.ok(t >= RANGE_START && t <= RANGE_END, "输出必须在窗口内");
    const wd = new Date(b.start).getUTCDay();
    assert.equal(wd, 1, "必须是周一");
  }
  const first = new Date(blocks[0].start).toISOString().slice(0, 10);
  assert.ok(first >= "2026-10-12", "第一个输出不得早于窗口起点所在周");
});

test("窗口：无 RRULE 单次事件在窗口外被丢弃", () => {
  const ics = vcal(
    vev(["UID:out-1", "DTSTART;TZID=Asia/Shanghai:20260901T080000", "DTEND;TZID=Asia/Shanghai:20260901T094000", "SUMMARY:过去课"]) + "\n" +
    vev(["UID:in-1", "DTSTART;TZID=Asia/Shanghai:20261020T080000", "DTEND;TZID=Asia/Shanghai:20261020T094000", "SUMMARY:未来课"])
  );
  const blocks = conv(ics);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].title, "未来课");
});

test("窗口：UNTIL 早于窗口 → 无输出", () => {
  const ics = vcal(vev([
    "UID:until-1",
    "DTSTART;TZID=Asia/Shanghai:20261005T080000",
    "DTEND;TZID=Asia/Shanghai:20261005T094000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261006T000000Z",
    "SUMMARY:已结束课",
  ]));
  const blocks = conv(ics);
  assert.equal(blocks.length, 0);
});

/* ========== 13. 导出结构 ========== */
test("buildBackup 对齐 WorkGrid schema（taskCount==tasks.length）", () => {
  const ics = vcal(vev([
    "UID:bk-1",
    "DTSTART;TZID=Asia/Shanghai:20261012T080000",
    "DTEND;TZID=Asia/Shanghai:20261012T094000",
    "SUMMARY:导出课",
  ]));
  const blocks = conv(ics);
  const { ok, bad } = validateBlocks(blocks);
  assert.equal(bad.length, 0, "全部合法");
  const backup = buildBackup(ok);
  assert.equal(backup.format, "workgrid-backup");
  assert.equal(backup.schemaVersion, 6);
  assert.equal(backup.taskCount, backup.tasks.length);
  assert.ok(backup.appVersion && backup.exportedAt);
  // 逐字段合法性
  for (const b of backup.tasks) {
    assert.ok(b.id.length >= 1 && b.id.length <= 200);
    assert.ok(b.title.length >= 1 && b.title.length <= 60);
    assert.ok(b.duration >= 1 && b.duration <= 720);
    assert.ok(!Number.isNaN(Date.parse(b.start)));
    assert.ok(!Number.isNaN(Date.parse(b.createdAt)));
  }
});

/* ========== 14. 真实课表回归（本地文件存在时） ========== */
const realIcsPath = path.join(process.env.TEMP || "C:\\Users\\ASUS\\AppData\\Local\\Temp", "abdn_ics_test.ics");
if (fs.existsSync(realIcsPath)) {
  test("真实课表回归：全部事件窗口内转换、id 唯一、校验通过", () => {
    const txt = fs.readFileSync(realIcsPath, "utf8");
    const lines = unfoldICS(txt);
    const events = extractEvents(lines);
    assert.ok(events.length >= 100, "真实课表事件数 ≥ 100，实际 " + events.length);
    const now = new Date();
    const rs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const o = opts({ rangeStart: rs, rangeEnd: rs + 42 * DAY - 1 });
    const recIdMap = collectRecIdMs(events);
    const blocks = events.flatMap(ev => eventToBlocks(ev, o, recIdMap));
    assert.ok(blocks.length > 0);
    const { ok, bad } = validateBlocks(blocks);
    assert.equal(bad.length, 0, "真实课表应全部通过校验，bad=" + JSON.stringify(bad.slice(0, 3)));
    assert.equal(ok.length, blocks.length);
    const ids = new Set(blocks.map(b => b.id));
    assert.equal(ids.size, blocks.length, "id 必须全局唯一");
    for (const b of blocks) {
      assert.ok(Date.parse(b.start) >= rs && Date.parse(b.start) <= rs + 42 * DAY - 1, "start 必须在窗口内");
    }
    console.log("      （真实课表事件数=" + events.length + "，窗口内转换出 " + blocks.length + " 节）");
  });
} else {
  console.log("SKIP 真实课表回归（未找到 abdn_ics_test.ics）");
}

/* ========== 汇总 ========== */
console.log("\n结果：" + passed + " 通过，" + failed + " 失败");
process.exit(failed ? 1 : 0);
