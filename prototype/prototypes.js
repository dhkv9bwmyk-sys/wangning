(function (root) {
  'use strict';

  function render(view) {
    if (view.querySelector('#course-planner-prototype')) return;
    const frame = document.createElement('iframe');
    frame.id = 'course-planner-prototype';
    frame.title = '调课助手 · 套班联动工作台';
    const bundled = document.getElementById('offline-course-planner');
    if (bundled) frame.srcdoc = JSON.parse(bundled.textContent);
    else frame.src = 'prototypes/course-planner/?v=planner-load-1123';
    view.replaceChildren(frame);
  }

  root.DeskPrototypes = {render};
})(window);
