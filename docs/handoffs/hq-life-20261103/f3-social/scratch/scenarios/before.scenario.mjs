const url = 'http://127.0.0.1:5310/';
const social = [{ click: 'Social', after: 600 }];
const page = (name) => [...social, { click: name, after: 700 }];
const views = (theme) => [
  { name: `before-overview-${theme}`, theme, steps: page('Overview') },
  { name: `before-sources-${theme}`, theme, steps: page('Sources') },
  { name: `before-workbenches-${theme}`, theme, steps: page('Workbenches') },
  { name: `before-workbench-writing-${theme}`, theme, steps: [...page('Workbenches'), { click: 'Open Writing studio', after: 700 }, { click: 'Load example', role: 'any', after: 400 }, { click: 'Run Writing studio', role: 'any', after: 1500 }] },
  { name: `before-library-${theme}`, theme, steps: page('Library') },
  { name: `before-calendar-${theme}`, theme, steps: page('Calendar') },
  { name: `before-runs-${theme}`, theme, steps: page('Run history') },
  { name: `before-channels-${theme}`, theme, steps: page('Channels & accounts') },
];
export default { url, shots: [...views('light'), ...views('dark')] };
