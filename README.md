# cx-// ==UserScript==
// @name         超级学长-学管沟通回访自动填写
// @namespace    local.crm.followup
// @version      1.0.0
// @description  自动处理学管沟通回访表：随机近5天日期、10:00-20:00随机时间、统一填写学习情况沟通、反馈正常并提交。
// @match        https://crm.chaojixuezhang.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /**********************
   * 可改配置区
   **********************/
  const CONFIG = {
    // 每次最多自动处理多少条。建议先用 1 测试，确认没问题再改大。
    maxPerRun: 10,

    // 是否自动点击“确定”提交。
    // true = 自动提交；false = 只填写不提交，方便你检查。
    autoSubmit: true,

    // 日期范围：当天往前推 N 天内随机。
    // 5 表示：今天、昨天、前天……最多往前 5 天。
    randomDateBackDays: 5,

    // 沟通开始时间范围。
    startHour: 10,
    endHour: 20,

    // 结束时间比开始时间晚 5~15 分钟。
    minDurationMinutes: 5,
    maxDurationMinutes: 15,

    // 所有文本框填写内容。
    textValue: '学习情况沟通',

    // 每条提交后等待时间，网络慢可改大。
    waitAfterSubmitMs: 1800
  };

  /**********************
   * 工具函数
   **********************/
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pad = (n) => String(n).padStart(2, '0');

  function log(message) {
    const box = document.querySelector('#followup-auto-log');
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    console.log(line);
    if (box) {
      box.textContent = `${line}\n${box.textContent}`.slice(0, 5000);
    }
  }

  function formatDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function randomRecentDate() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const offset = randInt(0, CONFIG.randomDateBackDays);
    const d = new Date(today);
    d.setDate(today.getDate() - offset);
    return formatDate(d);
  }

  function randomTimes() {
    const duration = randInt(CONFIG.minDurationMinutes, CONFIG.maxDurationMinutes);
    const latestStart = CONFIG.endHour * 60 - duration;
    const start = randInt(CONFIG.startHour * 60, latestStart);
    const end = start + duration;
    return {
      start: `${pad(Math.floor(start / 60))}:${pad(start % 60)}`,
      end: `${pad(Math.floor(end / 60))}:${pad(end % 60)}`,
      duration
    };
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ');
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    descriptor.set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function clickEl(el) {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }

  function findVisibleDialog() {
    return [...document.querySelectorAll('.el-dialog')]
      .find(el => visible(el) && textOf(el).includes('家长回访'));
  }

  function findButtonByText(root, keyword) {
    return [...root.querySelectorAll('button')]
      .find(btn => visible(btn) && textOf(btn).replace(/\s+/g, '').includes(keyword));
  }

  function findInputByPlaceholder(root, placeholder) {
    return [...root.querySelectorAll('input, textarea')]
      .find(el => visible(el) && el.placeholder === placeholder);
  }

  function getPendingRows() {
    const rows = [...document.querySelectorAll('.el-table__body-wrapper tbody tr')]
      .filter(row => visible(row) && textOf(row).includes('待处理'));
    return rows.map(row => {
      const cells = [...row.querySelectorAll('td')].map(td => textOf(td));
      const button = [...row.querySelectorAll('button')]
        .find(btn => visible(btn) && textOf(btn).replace(/\s+/g, '').includes('处理'));
      return {
        row,
        button,
        id: cells[0] || '',
        student: cells[2] || '',
        originalDate: cells[9] || '',
        rowText: textOf(row)
      };
    }).filter(item => item.button);
  }

  async function waitForDialog(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const dialog = findVisibleDialog();
      if (dialog) return dialog;
      await sleep(100);
    }
    throw new Error('没有等到“家长回访”弹窗');
  }

  async function waitDialogClosed(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!findVisibleDialog()) return true;
      await sleep(150);
    }
    return false;
  }

  async function fillDialog(dialog, date, times) {
    const dateInput = findInputByPlaceholder(dialog, '选择日期');
    const startInput = findInputByPlaceholder(dialog, '开始时间');
    const endInput = findInputByPlaceholder(dialog, '结束时间');

    if (!dateInput || !startInput || !endInput) {
      throw new Error('日期或时间输入框没有找到');
    }

    setNativeValue(dateInput, date);
    setNativeValue(startInput, times.start);
    setNativeValue(endInput, times.end);

    const placeholders = [
      '请输入学员沟通内容',
      '请输入学员反馈内容',
      '请输入家长回访内容',
      '请输入家长反馈内容'
    ];

    for (const ph of placeholders) {
      const el = findInputByPlaceholder(dialog, ph);
      if (!el) throw new Error(`没有找到文本框：${ph}`);
      setNativeValue(el, CONFIG.textValue);
    }

    const normalRadioLabel = [...dialog.querySelectorAll('label.el-radio')]
      .find(label => visible(label) && textOf(label).includes('正常'));
    if (!normalRadioLabel) throw new Error('没有找到“正常”反馈状态');
    clickEl(normalRadioLabel);

    await sleep(300);

    // 校验一遍，避免没写进去就提交。
    const checks = [
      ['选择日期', date],
      ['开始时间', times.start],
      ['结束时间', times.end],
      ['请输入学员沟通内容', CONFIG.textValue],
      ['请输入学员反馈内容', CONFIG.textValue],
      ['请输入家长回访内容', CONFIG.textValue],
      ['请输入家长反馈内容', CONFIG.textValue]
    ];

    for (const [ph, expected] of checks) {
      const el = findInputByPlaceholder(dialog, ph);
      if (!el || el.value !== expected) {
        throw new Error(`字段校验失败：${ph}，期望 ${expected}，实际 ${el ? el.value : '未找到'}`);
      }
    }

    const normalInput = [...dialog.querySelectorAll('input[type="radio"]')]
      .find(input => input.value === '0');
    if (normalInput && !normalInput.checked) {
      throw new Error('反馈状态“正常”没有选中');
    }
  }

  async function processOne(item) {
    const date = randomRecentDate();
    const times = randomTimes();

    log(`开始处理：${item.student || item.id}，日期 ${date}，时间 ${times.start}-${times.end}`);
    clickEl(item.button);

    const dialog = await waitForDialog();
    await sleep(300);
    await fillDialog(dialog, date, times);

    if (!CONFIG.autoSubmit) {
      log(`已填写但未提交：${item.student || item.id}`);
      return { submitted: false, date, times };
    }

    const submit = findButtonByText(dialog, '确定');
    if (!submit) throw new Error('没有找到“确定”按钮');
    clickEl(submit);

    await sleep(CONFIG.waitAfterSubmitMs);
    const closed = await waitDialogClosed();
    if (!closed) throw new Error('提交后弹窗没有关闭，可能保存失败');

    log(`提交成功：${item.student || item.id}`);
    return { submitted: true, date, times };
  }

  async function run() {
    const startBtn = document.querySelector('#followup-auto-start');
    if (startBtn) startBtn.disabled = true;

    try {
      let done = 0;
      for (let i = 0; i < CONFIG.maxPerRun; i++) {
        const rows = getPendingRows();
        if (!rows.length) {
          log('当前页没有找到待处理记录。');
          break;
        }

        await processOne(rows[0]);
        done++;
        await sleep(800);
      }
      log(`本次完成 ${done} 条。`);
    } catch (err) {
      console.error(err);
      log(`停止：${err.message}`);
      alert(`自动填写已停止：\n${err.message}\n\n请检查当前页面后再继续。`);
    } finally {
      if (startBtn) startBtn.disabled = false;
    }
  }

  function installPanel() {
    if (document.querySelector('#followup-auto-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'followup-auto-panel';
    panel.style.cssText = `
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 999999;
      width: 310px;
      background: white;
      border: 1px solid #409EFF;
      border-radius: 10px;
      box-shadow: 0 4px 18px rgba(0,0,0,.18);
      font-size: 13px;
      color: #333;
      overflow: hidden;
      font-family: Arial, 'Microsoft YaHei', sans-serif;
    `;

    panel.innerHTML = `
      <div style="background:#409EFF;color:white;padding:9px 12px;font-weight:bold;">
        学管回访自动填写
      </div>
      <div style="padding:10px 12px;line-height:1.7;">
        <div>日期：今天往前 ${CONFIG.randomDateBackDays} 天内随机</div>
        <div>时间：${pad(CONFIG.startHour)}:00-${pad(CONFIG.endHour)}:00，结束晚 ${CONFIG.minDurationMinutes}-${CONFIG.maxDurationMinutes} 分钟</div>
        <div>内容：${CONFIG.textValue}</div>
        <div>提交：${CONFIG.autoSubmit ? '自动提交' : '只填写不提交'}</div>
        <button id="followup-auto-start" style="margin-top:8px;width:100%;height:34px;border:0;border-radius:6px;background:#409EFF;color:white;cursor:pointer;font-weight:bold;">
          开始处理当前页
        </button>
        <pre id="followup-auto-log" style="margin-top:8px;height:120px;overflow:auto;background:#f6f8fa;border:1px solid #e5e7eb;padding:8px;white-space:pre-wrap;font-size:12px;"></pre>
      </div>
    `;

    document.body.appendChild(panel);
    document.querySelector('#followup-auto-start').addEventListener('click', run);
  }

  // 页面是后台系统，路由切换不一定刷新，所以定时确保面板存在。
  setInterval(() => {
    if (location.href.includes('/student/service/FollowUpComm')) {
      installPanel();
    }
  }, 1000);
})();
