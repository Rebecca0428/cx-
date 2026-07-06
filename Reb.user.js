// ==UserScript==
// @name         超级学长-学管沟通回访自动填写
// @namespace    local.crm.followup
// @version      1.0.14
// @updateURL    https://raw.githubusercontent.com/Rebecca0428/cx-/main/Reb.user.js
// @downloadURL  https://github.com/Rebecca0428/cx-/raw/main/Reb.user.js
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

    // 默认速度模式：fast = 加速模式；stable = 稳定模式。也可以在右下面板里切换。
    defaultSpeedMode: 'fast'
  };

  /**********************
   * 工具函数
   **********************/
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const SPEED_STORAGE_KEY = 'followup-auto-speed-mode';
  const TEXT_STORAGE_KEY = 'followup-auto-text-value';
  const SPEED_PRESETS = {
    stable: {
      label: '稳定模式',
      dateFocus: 80,
      dateClear: 30,
      dateBlur: 120,
      radio: 300,
      dialogWait: 3000,
      retryGap: 250,
      poll: 100,
      closePoll: 150,
      afterRow: 800,
      afterSubmit: 1800
    },
    fast: {
      label: '加速模式',
      dateFocus: 35,
      dateClear: 15,
      dateBlur: 60,
      radio: 120,
      dialogWait: 1200,
      retryGap: 100,
      poll: 60,
      closePoll: 80,
      afterRow: 250,
      afterSubmit: 900
    }
  };

  function getSpeedMode() {
    const saved = localStorage.getItem(SPEED_STORAGE_KEY);
    return SPEED_PRESETS[saved] ? saved : CONFIG.defaultSpeedMode;
  }

  function setSpeedMode(mode) {
    if (!SPEED_PRESETS[mode]) return;
    localStorage.setItem(SPEED_STORAGE_KEY, mode);
    refreshSpeedPanel();
    log('已切换为：' + SPEED_PRESETS[mode].label);
  }

  function getTextValue() {
    const saved = localStorage.getItem(TEXT_STORAGE_KEY);
    return saved && saved.trim() ? saved : CONFIG.textValue;
  }

  function setTextValue(value, silent = false) {
    const next = String(value || '').trim() || CONFIG.textValue;
    localStorage.setItem(TEXT_STORAGE_KEY, next);
    refreshTextPanel();
    if (!silent) log('已保存填写内容：' + next);
  }

  function saveTextInputNow(silent = true) {
    const input = document.querySelector('#followup-auto-text-value');
    if (!input) return;
    const next = String(input.value || '').trim() || CONFIG.textValue;
    localStorage.setItem(TEXT_STORAGE_KEY, next);
    const label = document.querySelector('#followup-auto-text-label');
    if (label) label.textContent = next;
    if (!silent) log('已保存填写内容：' + next);
  }

  function detectStudentName(item, dialog) {
    const fromRow = String(item?.student || '').trim();
    if (fromRow) return fromRow;

    const dialogText = textOf(dialog || document.body);
    const match = dialogText.match(/学生[:：]s*([^s，,；;]+)/);
    return match ? match[1].trim() : '';
  }

  function renderTextValue(item, dialog) {
    const student = detectStudentName(item, dialog);
    const template = getTextValue();
    if (!student) return template;

    // 支持两种写法：
    // 1. 变量写法：{学生}上课认真
    // 2. 普通写法：学生上课认真 —— 会自动把“学生”替换成当前学生姓名
    return template
      .replace(/{学生}|{学生姓名}|{姓名}|{student}|{name}/gi, student)
      .replace(/【学生】|【学生姓名】/g, student)
      .replace(/学生/g, student);
  }

  function isFollowupPage() {  function isFollowupPage() {
    return location.href.includes('/student/service/FollowUpComm')
      || location.hash.includes('/student/service/FollowUpComm');
  }

  function goFollowupPage() {
    // 当前系统使用 hash 路由，直接切到学管沟通回访表。
    location.hash = '/student/service/FollowUpComm';
    setTimeout(() => {
      installPanel(true);
      refreshPageStatusPanel();
    }, 800);
  }

  function refreshPageStatusPanel() {
    const status = document.querySelector('#followup-auto-page-status');
    const goBtn = document.querySelector('#followup-auto-go-page');
    const startBtn = document.querySelector('#followup-auto-start');
    const onPage = isFollowupPage();
    if (status) status.textContent = onPage ? '当前：回访表页面，可处理' : '当前：不是回访表页面';
    if (goBtn) goBtn.style.display = onPage ? 'none' : 'block';
    if (startBtn) startBtn.textContent = onPage ? '开始处理当前页' : '请先前往回访表';
  }

  function refreshTextPanel() {
    const input = document.querySelector('#followup-auto-text-value');
    const label = document.querySelector('#followup-auto-text-label');
    const value = getTextValue();

    // 输入框正在编辑时，不要每秒用旧值覆盖用户正在输入的文字。
    if (input && document.activeElement !== input && input.value !== value) {
      input.value = value;
    }
    if (label) label.textContent = value;
  }

  function speedValue(key) {
    return SPEED_PRESETS[getSpeedMode()][key];
  }

  function refreshSpeedPanel() {
    const mode = getSpeedMode();
    const label = document.querySelector('#followup-auto-speed-label');
    const btn = document.querySelector('#followup-auto-speed-toggle');
    if (label) label.textContent = SPEED_PRESETS[mode].label;
    if (btn) btn.textContent = mode === 'fast' ? '切换到稳定模式' : '切换到加速模式';
  }

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

  async function setDateTimeByDom(el, value) {
    // 专门给 Element UI 的日期/时间输入框用：
    // 只改 input.value 往往不够，需要模拟真实用户的 DOM 事件链。
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.removeAttribute('readonly');
    el.focus();
    el.click();
    await sleep(speedValue('dateFocus'));

    setNativeValue(el, '');
    await sleep(speedValue('dateClear'));
    setNativeValue(el, value);

    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true
    }));
    el.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    await sleep(speedValue('dateBlur'));
  }

  function clickableOf(el) {
    if (!el) return null;
    const clickable = el.closest?.('button.el-button, button, a, [role="button"], .el-button');
    if (clickable && visible(clickable) && !clickable.disabled && !clickable.classList.contains('is-disabled')) {
      return clickable;
    }
    return el;
  }

  function dispatchMouse(target, type, x, y) {
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y,
      button: 0,
      buttons: type === 'mousedown' || type === 'pointerdown' ? 1 : 0
    };
    const EventCtor = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
    target.dispatchEvent(new EventCtor(type, eventInit));
  }

  function callVueClickHandlers(button) {
    // Element UI 是 Vue 2 组件，真正的 @click 可能挂在 button.__vue__.$listeners.click。
    // 普通 DOM click 如果被固定列/遮罩/组件包装挡住，就直接调用 Vue 绑定的 click 回调。
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window });
    const called = new Set();
    const callOne = fn => {
      if (typeof fn !== 'function' || called.has(fn)) return false;
      called.add(fn);
      fn.call(button.__vue__?.$parent || button.__vue__ || button, event);
      return true;
    };

    let count = 0;
    const vms = [];
    let node = button;
    while (node && vms.length < 8) {
      if (node.__vue__) vms.push(node.__vue__);
      node = node.parentElement;
    }

    for (const vm of vms) {
      const listeners = [
        vm.$listeners?.click,
        vm.$vnode?.data?.on?.click,
        vm.$options?._parentListeners?.click
      ];
      for (const handler of listeners) {
        if (!handler) continue;
        if (Array.isArray(handler)) {
          for (const fn of handler) count += callOne(fn) ? 1 : 0;
        } else if (Array.isArray(handler.fns)) {
          for (const fn of handler.fns) count += callOne(fn) ? 1 : 0;
        } else if (handler.fns) {
          count += callOne(handler.fns) ? 1 : 0;
        } else {
          count += callOne(handler) ? 1 : 0;
        }
      }
    }
    return count;
  }

  function clickEl(el, useVueDirect = false) {
    const target = clickableOf(el);
    if (!target) return false;

    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    const x = Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));

    target.focus?.();

    // 1) 原生 DOM 点击。
    if (target instanceof HTMLButtonElement) {
      HTMLButtonElement.prototype.click.call(target);
    } else if (target instanceof HTMLElement) {
      HTMLElement.prototype.click.call(target);
    } else {
      target.click?.();
    }
    target.click?.();

    // 2) 完整鼠标事件链。
    for (const type of ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      dispatchMouse(target, type, x, y);
    }

    // 3) 只给“处理”按钮启用 Vue 直调，避免影响后面的单选和确定提交。
    if (useVueDirect) {
      callVueClickHandlers(target);
    }

    return true;
  }

  function findVisibleDialog() {
    return [...document.querySelectorAll('.el-dialog')]
      .find(el => {
        if (!visible(el)) return false;
        const t = textOf(el);
        // 支持两种弹窗：家长回访、学员沟通。也兼容只按字段判断的弹窗。
        return t.includes('家长回访')
          || t.includes('学员沟通')
          || (t.includes('沟通日期') && t.includes('反馈状态'));
      });
  }

  function findButtonByText(root, keyword) {
    return [...root.querySelectorAll('button')]
      .find(btn => visible(btn) && textOf(btn).replace(/\s+/g, '').includes(keyword));
  }

  function findInputByPlaceholder(root, placeholder) {
    return [...root.querySelectorAll('input, textarea')]
      .find(el => visible(el) && el.placeholder === placeholder);
  }

  function findProcessButtonForRow(row, rowIndex) {
    // 只找右侧操作列里的蓝色“处 理”真实按钮。
    // 注意：中间“处理状态”列是“待处理”，不能用 includes('处理')，必须精确等于“处理”。
    const normalize = value => String(value || '').replace(/\s+/g, '');
    const isProcessButton = el => {
      if (!visible(el)) return false;
      if (!el.matches?.('button.el-button, button')) return false;
      return normalize(textOf(el)) === '处理';
    };
    const pickButton = root => {
      const candidates = [...root.querySelectorAll('button.el-button, button')]
        .filter(isProcessButton);
      return candidates.map(clickableOf).find(Boolean) || null;
    };

    // 普通主表格行一般没有操作按钮；如果有，也必须是真 button 且文字精确为“处理”。
    const directButton = pickButton(row);
    if (directButton) return directButton;

    const rowRect = row.getBoundingClientRect();
    const rowCenterY = rowRect.top + rowRect.height / 2;
    const fixedRows = [...document.querySelectorAll('.el-table__fixed-right tbody tr, .el-table__fixed tbody tr')]
      .filter(visible);

    // 优先按同一水平线找右侧固定操作列的真实 button。
    const sameLineRows = fixedRows
      .map(fixedRow => {
        const rect = fixedRow.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        return { fixedRow, distance: Math.abs(centerY - rowCenterY), rect };
      })
      .filter(item => rowCenterY >= item.rect.top - 4 && rowCenterY <= item.rect.bottom + 4)
      .sort((a, b) => a.distance - b.distance);

    for (const item of sameLineRows) {
      const btn = pickButton(item.fixedRow);
      if (btn) return btn;
    }

    // 兜底：按主表格行号配对固定列行。
    const fixedRow = fixedRows[rowIndex];
    if (fixedRow) {
      const btn = pickButton(fixedRow);
      if (btn) return btn;
    }

    // 最后兜底：只在固定操作列所有真实 button 中找垂直距离最近且文字精确等于“处理”的按钮。
    const allProcessButtons = [...document.querySelectorAll('.el-table__fixed-right button.el-button, .el-table__fixed-right button, .el-table__fixed button.el-button, .el-table__fixed button')]
      .filter(isProcessButton)
      .map(clickableOf)
      .filter(Boolean)
      .map(btn => {
        const rect = btn.getBoundingClientRect();
        return { btn, distance: Math.abs(rect.top + rect.height / 2 - rowCenterY) };
      })
      .sort((a, b) => a.distance - b.distance);

    return allProcessButtons[0]?.btn || null;
  }
  function getPendingRows() {
    const allRows = [...document.querySelectorAll('.el-table__body-wrapper tbody tr')]
      .filter(row => visible(row) && !row.closest('.el-table__fixed, .el-table__fixed-right'));
    const rows = allRows
      .map((row, rowIndex) => ({ row, rowIndex }))
      .filter(item => textOf(item.row).includes('待处理'));

    return rows.map(({ row, rowIndex }) => {
      const cells = [...row.querySelectorAll('td')].map(td => textOf(td));
      const button = findProcessButtonForRow(row, rowIndex);
      return {
        row,
        rowIndex,
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
      await sleep(speedValue('poll'));
    }
    throw new Error('没有等到回访/沟通弹窗');
  }

  async function waitDialogClosed(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!findVisibleDialog()) return true;
      await sleep(speedValue('closePoll'));
    }
    return false;
  }

  async function fillDialog(dialog, date, times, item) {
    const dateInput = findInputByPlaceholder(dialog, '选择日期');
    const startInput = findInputByPlaceholder(dialog, '开始时间');
    const endInput = findInputByPlaceholder(dialog, '结束时间');

    if (!dateInput || !startInput || !endInput) {
      throw new Error('日期或时间输入框没有找到');
    }

    await setDateTimeByDom(dateInput, date);
    await setDateTimeByDom(startInput, times.start);
    await setDateTimeByDom(endInput, times.end);

    const textValue = renderTextValue(item, dialog);

    // 家长回访弹窗有 4 个内容框；学员沟通弹窗只有 2 个内容框。
    // 这里按实际存在的输入框填写，不再强制要求 4 个都存在。
    const textPlaceholders = [
      '请输入学员沟通内容',
      '请输入学员反馈内容',
      '请输入家长回访内容',
      '请输入家长反馈内容'
    ];

    const filledTextInputs = [];
    for (const ph of textPlaceholders) {
      const el = findInputByPlaceholder(dialog, ph);
      if (!el) continue;
      setNativeValue(el, textValue);
      filledTextInputs.push([ph, el]);
    }

    // 兜底：如果页面 placeholder 改了，就填写弹窗里所有可见 textarea。
    if (!filledTextInputs.length) {
      const textareas = [...dialog.querySelectorAll('textarea')].filter(visible);
      for (const el of textareas) {
        setNativeValue(el, textValue);
        filledTextInputs.push([el.placeholder || '文本框', el]);
      }
    }

    if (!filledTextInputs.length) {
      throw new Error('没有找到需要填写的内容文本框');
    }

    const normalRadioLabel = [...dialog.querySelectorAll('label.el-radio')]
      .find(label => visible(label) && textOf(label).includes('正常'));
    if (!normalRadioLabel) throw new Error('没有找到“正常”反馈状态');
    clickEl(normalRadioLabel);

    await sleep(speedValue('radio'));

    // 校验一遍，避免没写进去就提交。只校验当前弹窗实际存在的字段。
    const checks = [
      ['选择日期', date],
      ['开始时间', times.start],
      ['结束时间', times.end]
    ];

    for (const [ph, el] of filledTextInputs) {
      checks.push([ph, textValue]);
    }

    for (const [ph, expected] of checks) {
      const el = ['选择日期', '开始时间', '结束时间'].includes(ph)
        ? findInputByPlaceholder(dialog, ph)
        : filledTextInputs.find(([name]) => name === ph)?.[1];
      if (!el || el.value !== expected) {
        throw new Error('字段校验失败：' + ph + '，期望 ' + expected + '，实际 ' + (el ? el.value : '未找到'));
      }
    }

    const normalInput = [...dialog.querySelectorAll('input[type="radio"]')]
      .find(input => input.value === '0');
    if (normalInput && !normalInput.checked) {
      throw new Error('反馈状态“正常”没有选中');
    }
  }

  async function openProcessDialog(item) {
    // 纯 DOM/Vue 方式点击处理按钮：重新定位真实 button.el-button，并直接调用 Vue click 监听器。
    for (let attempt = 1; attempt <= 4; attempt++) {
      const button = findProcessButtonForRow(item.row, item.rowIndex) || item.button;

      if (!button) break;
      log(`DOM点击处理按钮：第 ${attempt} 次，按钮文字：${textOf(button)}`);
      clickEl(button, true);

      const start = Date.now();
      while (Date.now() - start < speedValue('dialogWait')) {
        const dialog = findVisibleDialog();
        if (dialog) return dialog;
        await sleep(speedValue('poll'));
      }
      await sleep(speedValue('retryGap'));
    }

    throw new Error('已找到右侧蓝色“处理”按钮并尝试点击，但没有弹出回访窗口；请确认该行是否能手动打开。');
  }

  async function processOne(item) {
    const date = randomRecentDate();
    const times = randomTimes();

    log(`开始处理：${item.student || item.id}，日期 ${date}，时间 ${times.start}-${times.end}`);
    const dialog = await openProcessDialog(item);
    await sleep(speedValue('radio'));
    await fillDialog(dialog, date, times, item);

    if (!CONFIG.autoSubmit) {
      log(`已填写但未提交：${item.student || item.id}`);
      return { submitted: false, date, times };
    }

    const submit = findButtonByText(dialog, '确定');
    if (!submit) throw new Error('没有找到“确定”按钮');
    clickEl(submit);

    await sleep(speedValue('afterSubmit'));
    const closed = await waitDialogClosed();
    if (!closed) throw new Error('提交后弹窗没有关闭，可能保存失败');

    log(`提交成功：${item.student || item.id}`);
    return { submitted: true, date, times };
  }

  async function run() {
    if (!isFollowupPage()) {
      log('当前不是学管沟通回访表页面，请先点击“前往回访表”。');
      alert('当前不是学管沟通回访表页面，请先点击面板里的“前往回访表”。');
      return;
    }

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
        await sleep(speedValue('afterRow'));
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

  function installPanel(forceRefresh = false) {
    const oldPanel = document.querySelector('#followup-auto-panel');
    if (oldPanel && !forceRefresh) {
      refreshPageStatusPanel();
      refreshTextPanel();
      refreshSpeedPanel();
      return;
    }
    if (oldPanel) oldPanel.remove();

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
        <div id="followup-auto-page-status" style="font-weight:bold;color:#409EFF;"></div>
        <button id="followup-auto-go-page" style="margin:6px 0;width:100%;height:30px;border:1px solid #E6A23C;border-radius:6px;background:white;color:#E6A23C;cursor:pointer;font-weight:bold;">前往学管沟通回访表</button>
        <div>日期：今天往前 ${CONFIG.randomDateBackDays} 天内随机</div>
        <div>时间：${pad(CONFIG.startHour)}:00-${pad(CONFIG.endHour)}:00，结束晚 ${CONFIG.minDurationMinutes}-${CONFIG.maxDurationMinutes} 分钟</div>
        <div>内容：<span id="followup-auto-text-label"></span></div>
        <input id="followup-auto-text-value" placeholder="例如：学生上课认真，态度端正" style="margin-top:6px;width:100%;height:30px;box-sizing:border-box;border:1px solid #dcdfe6;border-radius:6px;padding:0 8px;" />
        <div style="font-size:12px;color:#909399;line-height:1.4;">写“学生”或 {学生}，都会自动替换为当前处理学生姓名</div>
        <button id="followup-auto-text-save" style="margin-top:6px;width:100%;height:30px;border:1px solid #67C23A;border-radius:6px;background:white;color:#67C23A;cursor:pointer;font-weight:bold;">保存填写内容</button>
        <div>提交：${CONFIG.autoSubmit ? '自动提交' : '只填写不提交'}</div>
        <div>速度：<span id="followup-auto-speed-label"></span></div>
        <button id="followup-auto-speed-toggle" style="margin-top:6px;width:100%;height:30px;border:1px solid #409EFF;border-radius:6px;background:white;color:#409EFF;cursor:pointer;font-weight:bold;"></button>
        <button id="followup-auto-start" style="margin-top:8px;width:100%;height:34px;border:0;border-radius:6px;background:#409EFF;color:white;cursor:pointer;font-weight:bold;">
          开始处理当前页
        </button>
        <pre id="followup-auto-log" style="margin-top:8px;height:120px;overflow:auto;background:#f6f8fa;border:1px solid #e5e7eb;padding:8px;white-space:pre-wrap;font-size:12px;"></pre>
      </div>
    `;

    document.body.appendChild(panel);
    document.querySelector('#followup-auto-start').addEventListener('click', run);
    document.querySelector('#followup-auto-go-page').addEventListener('click', goFollowupPage);
    document.querySelector('#followup-auto-text-save').addEventListener('click', () => {
      setTextValue(document.querySelector('#followup-auto-text-value').value);
    });
    document.querySelector('#followup-auto-text-value').addEventListener('input', () => {
      // 边输入边自动保存，避免忘记点保存。
      saveTextInputNow(true);
    });
    document.querySelector('#followup-auto-text-value').addEventListener('blur', () => {
      saveTextInputNow(true);
      refreshTextPanel();
    });
    document.querySelector('#followup-auto-text-value').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        setTextValue(event.target.value);
      }
    });
    document.querySelector('#followup-auto-speed-toggle').addEventListener('click', () => {
      setSpeedMode(getSpeedMode() === 'fast' ? 'stable' : 'fast');
    });
    refreshTextPanel();
    refreshSpeedPanel();
    refreshPageStatusPanel();
  }

  // 页面是后台系统，路由切换不一定刷新，所以定时确保面板存在；现在所有 CRM 页面都显示控制台。
  setInterval(() => {
    installPanel();
    refreshPageStatusPanel();
  }, 1000);
})();
