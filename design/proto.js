
// Arrow keys step through screens; dead links explain themselves.
(function () {
  var bar = document.querySelector('.proto-bar');
  var toast = document.createElement('div');
  toast.className = 'proto-toast';
  toast.setAttribute('role', 'status');
  document.body.appendChild(toast);
  var t;
  function say(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(t);
    t = setTimeout(function () { toast.classList.remove('show'); }, 1600);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href="#"], button');
    if (!a || (bar && bar.contains(a))) return;
    if (a.tagName === 'A') e.preventDefault();
    say('Not linked in this prototype');
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    var links = bar ? bar.querySelectorAll('a[aria-label]') : [];
    links.forEach(function (l) {
      if (e.key === 'ArrowLeft' && l.getAttribute('aria-label') === 'Previous screen') location.href = l.href;
      if (e.key === 'ArrowRight' && l.getAttribute('aria-label') === 'Next screen') location.href = l.href;
    });
  });
})();
