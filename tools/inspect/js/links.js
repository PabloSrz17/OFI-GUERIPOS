() => [...document.querySelectorAll('aside a, nav a, header a')].map(a => ({ t: a.innerText.trim().replace(/\s+/g, ' '), h: a.getAttribute('href') }))
