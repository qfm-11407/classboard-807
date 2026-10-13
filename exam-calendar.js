(function (root) {
  'use strict';
  const dayIds = count => Array.from({length: Number(count) === 3 ? 3 : 2}, (_, index) => `day${index + 1}`);
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function validateDates(dates, count, required = false) {
    const ids = dayIds(count), values = ids.map(id => String(dates?.[id] || '').trim());
    if (!required && values.every(value => !value)) return {};
    if (values.some(value => !validDate(value))) throw new Error('請為每一天設定完整有效的考程日期。');
    if (new Set(values).size !== values.length) throw new Error('各天考程日期不能重複。');
    if (values.some((value, index) => index > 0 && value <= values[index - 1])) throw new Error('考程日期須依第 1 天、第 2 天、第 3 天的順序排列。');
    return Object.fromEntries(ids.map((id, index) => [id, values[index]]));
  }
  function selection({dates = {}, count = 2, activeDay = 'day1', today}) {
    const ids = dayIds(count), dated = ids.some(id => Boolean(dates?.[id]));
    if (dated) return {dated: true, day: ids.find(id => validDate(dates[id]) && dates[id] === today) || null};
    return {dated: false, day: ids.includes(activeDay) ? activeDay : 'day1'};
  }
  function taipeiClock(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now);
    const pick = type => parts.find(part => part.type === type)?.value || '';
    return {today: `${pick('year')}-${pick('month')}-${pick('day')}`, minutes: Number(pick('hour')) * 60 + Number(pick('minute'))};
  }
  root.ExamCalendar = {dayIds, validDate, validateDates, selection, taipeiClock};
})(typeof window !== 'undefined' ? window : globalThis);
