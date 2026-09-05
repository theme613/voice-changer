import urllib.request
import re
text = urllib.request.urlopen('http://127.0.0.1:18888/index.js').read().decode('utf-8')
endpoints = set(re.findall(r'\"(/[a-zA-Z0-9_]+)\"', text))
print([e for e in endpoints if 'info' in e or 'update' in e or 'model' in e or 'upload' in e])
