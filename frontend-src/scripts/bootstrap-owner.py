import json, subprocess, secrets, sys
P='twsched-f8b16'
def gapi(m,u,b=None):
    args=['bash','/home/sprite/ws/gapi.sh',m,u]+([json.dumps(b)] if b is not None else [])
    out=subprocess.run(args,capture_output=True,text=True).stdout
    return json.loads(out) if out.strip() else {}
email='andyblewett9@gmail.com'
q=gapi('POST',f'https://identitytoolkit.googleapis.com/v1/projects/{P}/accounts:lookup',{'email':[email]})
if q.get('users'):
    uid=q['users'][0]['localId']; print('exists')
else:
    r=gapi('POST',f'https://identitytoolkit.googleapis.com/v1/projects/{P}/accounts',{'email':email,'password':secrets.token_urlsafe(32),'displayName':'Andy'})
    uid=r.get('localId'); print('created' if uid else r)
r=gapi('POST',f'https://identitytoolkit.googleapis.com/v1/projects/{P}/accounts:update',{'localId':uid,'customAttributes':json.dumps({'role':'owner','primaryOwner':True})})
print('claims', 'ok' if r.get('localId') else r)
fields={'name':{'stringValue':'Andy'},'email':{'stringValue':email},'role':{'stringValue':'owner'},'jobTitle':{'stringValue':'Owner'},
 'phone':{'stringValue':''},'onRota':{'booleanValue':True},'active':{'booleanValue':True},'primaryOwner':{'booleanValue':True},
 'createdBy':{'stringValue':'bootstrap'}}
r=gapi('PATCH',f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents/staff/{uid}',{'fields':fields})
print('staff doc', 'ok' if r.get('name') else r)
print('uid', uid[:6]+'…')
