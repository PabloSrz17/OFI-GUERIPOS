() => [...document.querySelectorAll('main a')].map(a => `${a.innerText.trim().replace(/\s+/g, ' ').slice(0, 50)} -> ${a.getAttribute('href')}`).filter((v, i, s) => s.indexOf(v) === i).slice(0, 40)
