import os
import pathlib
import subprocess
import sys
import tempfile
import time

script = pathlib.Path(sys.argv[1]).read_bytes()
with tempfile.TemporaryDirectory(prefix='voice-3102-chrome-', ignore_cleanup_errors=True) as profile:
    chrome = subprocess.Popen([
        '/usr/bin/google-chrome', '--headless=new', '--no-sandbox', '--disable-gpu',
        '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run',
        '--remote-debugging-port=0', '--remote-allow-origins=*',
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        '--use-file-for-fake-audio-capture=' + os.environ.get('VOICE_AUDIO_FILE', '/home/cmp/work/luopeng/ai-agent-harness/.local/run/voice-test-44100.wav'),
        f'--user-data-dir={profile}',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        port_path = pathlib.Path(profile) / 'DevToolsActivePort'
        for _ in range(100):
            if port_path.exists():
                break
            if chrome.poll() is not None:
                raise RuntimeError('Chrome exited early')
            time.sleep(.1)
        else:
            raise TimeoutError('Chrome CDP not ready')
        port = port_path.read_text().splitlines()[0]
        cmd = ['docker', 'exec', '-i', '-e', f'VOICE_CDP_URL=http://127.0.0.1:{port}',
               'security-operations-expert-inspection008-lan', 'node', '--input-type=module', '-']
        result = subprocess.run(cmd, input=script, timeout=240)
        exit_code = result.returncode
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome.kill()

sys.exit(exit_code)
