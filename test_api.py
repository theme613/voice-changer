import urllib.request
import json
req = urllib.request.Request(
    'http://127.0.0.1:18888/update_settings', 
    data=b'{"serverAudioStated": 1}', 
    headers={'Content-Type': 'application/json'},
    method='POST'
)
print(urllib.request.urlopen(req).read().decode('utf-8'))
