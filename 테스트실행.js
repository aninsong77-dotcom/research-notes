// 참고문헌 파서 테스트를 실행하고 결과를 한국어로 요약해서 보여준다.
// 실행: node 테스트실행.js
// (영어 스택트레이스 그대로 보는 대신, 통과/실패 개수만 한눈에 보이게 하는 용도)

const { spawnSync } = require('node:child_process');

const result = spawnSync(process.execPath, ['--test', 'refparser.test.js'], {
    cwd: __dirname,
    encoding: 'utf-8',
});

const out = result.stdout + result.stderr;
console.log(out);

// node --test 요약줄은 "ℹ pass 27" 형태(버전에 따라 "# pass 27"일 수도 있음) — 둘 다 받는다.
const pass = out.match(/(?:ℹ|#)\s*pass (\d+)/)?.[1] ?? '?';
const fail = out.match(/(?:ℹ|#)\s*fail (\d+)/)?.[1] ?? '?';
const skip = out.match(/(?:ℹ|#)\s*skipped (\d+)/)?.[1] ?? '?';
const total = out.match(/(?:ℹ|#)\s*tests (\d+)/)?.[1] ?? '?';

console.log('─'.repeat(40));
if (fail === '0') {
    console.log(`✅ 전부 통과 — 총 ${total}개 중 통과 ${pass}개 · 알려진 미해결 ${skip}개(건너뜀)`);
} else {
    console.log(`❌ 실패 있음 — 총 ${total}개 중 실패 ${fail}개 · 통과 ${pass}개 · 건너뜀 ${skip}개`);
    console.log('   위 로그에서 "not ok"로 시작하는 줄을 찾아 원인을 확인하세요.');
}
console.log('─'.repeat(40));

process.exit(fail === '0' ? 0 : 1);
