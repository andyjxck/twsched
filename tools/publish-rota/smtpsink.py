# Local SMTP sink for emulator tests: accepts everything, writes each message as JSON lines. Sends nothing anywhere.
import asyncio, json, sys, email
from email import policy
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/pubrota/mail.jsonl'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 2599

async def handle(r, w):
    def send(s):
        w.write((s + '\r\n').encode())
    send('220 sink ready')
    await w.drain()
    rcpt = []
    while True:
        line = await r.readline()
        if not line:
            break
        cmd = line.decode(errors='replace').strip()
        up = cmd.upper()
        if up.startswith('EHLO'):
            send('250-sink')
            send('250-AUTH PLAIN LOGIN')
            send('250 8BITMIME')
        elif up.startswith('HELO'):
            send('250 sink')
        elif up.startswith('AUTH LOGIN'):
            send('334 VXNlcm5hbWU6'); await w.drain(); await r.readline()
            send('334 UGFzc3dvcmQ6'); await w.drain(); await r.readline()
            send('235 ok')
        elif up.startswith('AUTH'):
            if len(cmd.split()) < 3:
                send('334 '); await w.drain(); await r.readline()
            send('235 ok')
        elif up.startswith('MAIL FROM'):
            rcpt = []; send('250 ok')
        elif up.startswith('RCPT TO'):
            rcpt.append(cmd.split(':', 1)[1].strip().strip('<>')); send('250 ok')
        elif up == 'DATA':
            send('354 go'); await w.drain()
            buf = []
            while True:
                l = await r.readline()
                if l in (b'.\r\n', b'.\n') or not l:
                    break
                if l.startswith(b'..'):
                    l = l[1:]
                buf.append(l)
            msg = email.message_from_bytes(b''.join(buf), policy=policy.default)
            body = msg.get_body(preferencelist=('plain',))
            rec = {'to': rcpt, 'subject': str(msg['subject']), 'text': body.get_content() if body else ''}
            with open(OUT, 'a') as f:
                f.write(json.dumps(rec) + '\n')
            send('250 queued')
        elif up == 'QUIT':
            send('221 bye'); await w.drain(); break
        else:
            send('250 ok')
        await w.drain()
    w.close()

async def main():
    srv = await asyncio.start_server(handle, '127.0.0.1', PORT)
    async with srv:
        await srv.serve_forever()
asyncio.run(main())
