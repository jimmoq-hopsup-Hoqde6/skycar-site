// Browser fixtures verify customer recovery; these are not proof of hosted saves.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3193';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3193'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'test server must start');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const calls=[];
  await page.route('**/api/v1/care/guest-requests',async route => {
    const request=route.request();
    const data=await new Response(request.postDataBuffer(),{headers:{'content-type':request.headers()['content-type']}}).formData();
    const photos=data.getAll('photos');
    assert.equal(photos.length,1);
    assert.equal(photos[0].type,'image/jpeg');assert.ok(photos[0].size<=900000);
    calls.push({key:request.headers()['idempotency-key'],details:data.get('details'),hash:createHash('sha256').update(Buffer.from(await photos[0].arrayBuffer())).digest('hex')});
    if(calls.length===1) return route.abort('failed');
    return route.fulfill({status:201,json:{data:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',stage:'request_received',created_at:new Date().toISOString()}}});
  });
  await page.goto(`${origin}/care/request`);
  await page.getByLabel('Your car',{exact:true}).fill('Toyota Corolla 2020');
  await page.getByLabel('What would you like done?',{exact:true}).fill('Synthetic damage photo workflow test.');
  await page.getByLabel('Add damage photos').setInputFiles({name:'sample.jpg',mimeType:'image/jpeg',buffer:Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAFoAoADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDx+iiiuk5QooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACu60bRNI1K40mKKzhuImns0uyJ5EnjLyIkgkQnBQliFZOmUyck1wta8PifV4Ps5iulV7cxFJBDHvPlkFAzbcsFKrgMSPlHHApMaNdNCsk1e38OSQob26gAivvNJRp5NrR7cHaY/wCDOD99m7ABb630Kyl02O30tr2C+U/vVeTzSqu0OY1DY3sUL4YEfOowAOefh1nUIH0947jD6dJ5lqxRSYzu3dSORu5wcjJPHJp1pruo2NqLa3nVY1ZmQtEjNGSMEoxBZCcD7pHSizHdGtbaDby+C5rxki+3ndcxMbgBzEjKhAj3ZIOZGLYOPL69aueMdFsdNGoC3sLW1MOqPbW32W5abfEu/PmZdtrDEeAdpOW4445hdVvUljlWbDxwNbJ8i4EbKVK4xjkM3vznrS3WrX16bs3E+83dz9qmOxRul+b5uBx99uBgc+wosxXRv6vbaVZ2/wBt0/TbO7skn8pZDPMDgqSFnTcGWT5ScrhThsZxWmmhaTd+L9bs2sLO0sLK5exiJu2jAdpSiuWkk+ZlRXbAPJXoa5C/1zUNTjMd3Mrgv5jlYkQyPgjc5UAu3J5bJ5PqaZeate35uDczbzcXDXUpCKu6Vs5bge546DJxSsx3R0UuiW9sZ9LbS1luYdN+1y3H2jZMrmLzflRnCsqjhgFLcMc9BVyLw7pM9pe2/wBn2Xc0WmR2cvmNhJprRpWyM4O91C89N3GAK5+TxdrcxmaS7RnmSWN5Dbx7ykm7eu7bnadzcZwCcjBqlNrF/cQtDJcEoxgJAUD/AFMZji5Az8qkj36nJoswujp7zR9P0tbKX+zYbl7sW8flXNw0SRn7LBLIS25cMzSnGTgYPHTFTTtHt11fxJbSWMUjafE/kw39wIgjC5ij+d1dRkKzD72CemeKz5vFmtXN3cXU92ks1wUaQyW8bDci7VZQVwrBRjcMH3qlLq99PcajPJPul1HP2ptijzMyLIe3Hzqp4x0x0p2YXR0WreH7KbTILnSDZoTdyxSs98iLlYbdiiGRxuVXeUAjORjJPFS+ILDR/D2stajSVu4p7u4xumkBiiS4kiVEw33gI85bd1HHryTXc72MVkz5t4pHlRMDhnChjnryEX8vrWiPFOsCeac3Mbyyzvcl5LeNykrHLOhKnYSeflx0HpRZhdHQ2mjab517pcmn2ck0GtW+lreM8wJWQzAuQJAuf3akcY68VjSR6dqWnaq9tpi2L2CrLGyyOxdTIsZV9zEbvnByoX7p49Mdb+6S1ltlmYRSzJO47l0DBWz143t+f0q1fa9qOowNDczRlHcSSeXAkZlYZwzlVBc8nls9T60WFc6LRbbSb+Pw2k2iWe6/1c2U7rLOCY1+z9P3mAT5rZOPTGKpwW2nnUXS/s9KtcW5MIhupJoGk3KB5rJI7KMbsYI5254rEtdXvrL7F9nn2fYrk3Vv8inZKdmW5HP+rTg5HHuanXxBqCTGRPskZZDG6JZQqjqSDhkCbW5APIOCOKLDujcFtYWra9HcaBaF7O0juYQ9xK4y8sK8MkgDIVlJU9cEZJrkGIZiQoUE52joPzq5Jq19LJeO8+WvIlhn+RQGRWVlUDHygGNMYxgLjpxVKhCYUUUUxBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH//2Q==','base64')});
  await page.getByRole('button',{name:'Remove photo 1'}).waitFor();
  assert.equal(await page.getByAltText('Whole car uploaded photo').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Suburb',{exact:true}).fill('Adelaide');
  await page.getByLabel('Postcode',{exact:true}).fill('5000');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  assert.ok((await page.getByRole('region',{name:'Request summary'}).innerText()).includes('1 photo'));
  await page.getByLabel('Name',{exact:true}).fill('Synthetic Tester');
  await page.getByLabel('Email',{exact:true}).fill('photo-fixture@example.com');
  await page.getByLabel('Phone',{exact:true}).fill('0400000000');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Send my request',exact:true}).click();
  await page.getByRole('button',{name:'Check same request'}).waitFor();
  await page.getByRole('button',{name:'Check same request'}).click();
  await page.getByRole('heading',{name:'Request received.',exact:true}).waitFor();
  assert.deepEqual(calls[0],calls[1]);
  for(const width of [320,390,1440]) {
    await page.setViewportSize({width,height:900});await page.goto(`${origin}/care/request`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  assert.deepEqual(pageErrors,[]);
  console.log('PASS: damage preview, compression, summary, exact photo retry and three responsive widths');
} finally { if(browser) await browser.close(); server.kill('SIGTERM'); }
