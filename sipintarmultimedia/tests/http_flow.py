"""Each test deploys only this project's files, at / and at a renamed subdirectory."""
import http.cookiejar, json, os, pathlib, re, shutil, socket, subprocess, tempfile, time, urllib.request, urllib.error
root = pathlib.Path(__file__).resolve().parents[1]
APP = 'multimedia'
CONFIG_ENV = 'SIPINTARMULTIMEDIA_CONFIG'
PASSWORD_ENV = 'SIPINTARMULTIMEDIA_ADMIN_PASSWORD'
COOKIE = 'SIPINTAR_MULTIMEDIA_SESSION'
env = dict(os.environ, SIPINTAR_TEST_DB='sipintar_http_' + os.urandom(4).hex())
assert env.get('SIPINTAR_TEST_SOCKET'), 'Set SIPINTAR_TEST_SOCKET to an isolated database socket'
fixture = root / 'tests/http-fixture.php'
server = None
checks = 0
base = ''

def check(condition, label):
    global checks
    assert condition, label
    checks += 1
    print('PASS', label)

class Client:
    def __init__(self):
        self.jar=http.cookiejar.CookieJar()
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf=None
    def request(self, path, data=None, csrf=True):
        headers={}
        if data is not None:
            if isinstance(data, dict): data=json.dumps(data).encode(); headers['Content-Type']='application/json'
            else: data=data.encode(); headers['Content-Type']='application/x-www-form-urlencoded'
            if csrf and self.csrf: headers['X-CSRF-Token']=self.csrf
        try: response=self.opener.open(urllib.request.Request(base+path,data=data,headers=headers))
        except urllib.error.HTTPError as error: response=error
        return response.status, response.read().decode()
    def login(self, username):
        status, html=self.request('/index.php')
        self.csrf=json.loads(re.search(r'window.sipSession=(.*?);',html).group(1))['csrf']
        if APP=='sipintar':
            status, body=self.request('/api.php?action=login',{'username':username,'password':'Testing-password-123'})
            self.csrf=json.loads(body)['csrf']
        else:
            status, body=self.request('/index.php','form_type=login&username='+username+'&password=Testing-password-123')
            self.csrf=json.loads(re.search(r'window.sipSession=(.*?);',body).group(1))['csrf']
        check(status==200, username+' native login')
        check(any(c.name==COOKIE for c in self.jar),'project-specific session cookie')

def flow():
    admin=Client(); admin.login('admin')
    paths=['/','/index.php','/admin.php','/employees.php?q=Pegawai','/assets/client.js']
    paths+=['/pemantau.php','/pengunjung.php'] if APP=='sipintar' else ['/peminjam.php']
    for path in paths:
        status, body=admin.request(path)
        check(status==200,'standalone URL '+path)
        if '<html' in body.lower():
            for script in re.findall(r'<script\b[^>]*>(.*?)</script>',body,re.S):
                subprocess.run(['node','--check'],input=script,text=True,check=True,stdout=subprocess.DEVNULL)
        if path=='/admin.php':
            check('name="role_id"' in body and '_role"' not in body,'admin manages only one local project role')
    foreign=Client()
    # A valid session ID under the other project's cookie name must not authenticate here.
    for c in admin.jar:
        if c.name==COOKIE:
            import copy
            other=copy.copy(c)
            other.name='SIPINTAR_MULTIMEDIA_SESSION' if APP=='sipintar' else 'SIPINTAR_INVENTORY_SESSION'
            foreign.jar.set_cookie(other)
    check(foreign.request('/employees.php')[0]==401,'other project cookie cannot reuse local session')
    check(admin.request('/admin.php','action=role&name=forged',csrf=False)[0]==419,'admin mutation requires CSRF')
    employee=Client(); employee.login('pegawai')
    check(employee.request('/admin.php')[0]==403,'pegawai cannot manage accounts')
    status, body=employee.request('/')
    check(status==200 and ('form-pengambilan' if APP=='sipintar' else 'public_borrowing') in body,'root URL routes pegawai to own form')
    if APP=='sipintar':
        check(Client().request('/api.php?action=get_barang')[0]==401,'anonymous API denied')
        check(employee.request('/api.php?action=get_transaksi')[0]==403,'pegawai cannot read all history')
        check(employee.request('/api.php?action=save_barang',{'nama_barang':'X'})[0]==403,'pegawai cannot manage stock')
        payload={'kode_transaksi':'HTTP-'+os.urandom(4).hex(),'tipe':'MASUK','tanggal_pengambilan':'2026-09-13','nama_pengambil':'Forged Name','jabatan_unit':'TU','items':[{'nama_barang':'Pen','jumlah':2}]}
        check(employee.request('/api.php?action=simpan_transaksi',payload)[0]==200,'pegawai can submit outgoing transaction')
        row=json.loads(admin.request('/api.php?action=get_transaksi')[1])['data'][0]
        check(row['nama_pengambil']=='Pegawai Satu' and row['tipe']=='KELUAR','server resolves identity from Portal cache')
    else:
        loan='form_type=public_borrowing&borrowDate=2026-09-13&expectedReturnDate=2026-09-14&borrowerName=Forged&borrowerType=Guru&itemNameCustom=Projector&itemQty=1&borrowPurpose=Class'
        status,body=employee.request('/peminjam.php',loan)
        check(status==200 and 'MAN1-' in body,'pegawai can submit borrowing')
        status,body=admin.request('/index.php?view=data')
        check(status==200 and 'Pegawai Satu' in body and 'Projector' in body,'server resolves borrower identity from Portal cache')
    monitor=Client(); monitor.login('pemantau')
    if APP=='sipintar':
        check(monitor.request('/api.php?action=get_transaksi')[0]==200,'pemantau can read history')
        check(monitor.request('/api.php?action=simpan_transaksi',payload)[0]==403,'pemantau cannot change history')
        check(admin.request('/api.php?action=logout',{})[0]==200,'local logout')
    else:
        check(monitor.request('/index.php?view=data')[0]==200,'pemantau can read loans')
        check(monitor.request('/index.php','form_type=toggle_return&id=unknown&status=1')[0]==403,'pemantau cannot return loans')
        check(admin.request('/index.php','form_type=logout')[0]==200,'local logout')
    check(admin.request('/employees.php')[0]==401,'logout revokes local session')

try:
    subprocess.run(['php',str(fixture),'setup'],env=env,check=True)
    with tempfile.TemporaryDirectory(prefix='sipintar-standalone-') as tmp:
        config=pathlib.Path(tmp)/'config.php'
        settings={'database':{'host':'localhost','socket':env['SIPINTAR_TEST_SOCKET'],'database':env['SIPINTAR_TEST_DB'],'user':'root','password':''},'cookie_secure':False}
        raw=json.dumps(settings).replace('\\','\\\\').replace("'","\\'")
        config.write_text("<?php return json_decode('"+raw+"', true);")
        env[CONFIG_ENV]=str(config)
        env[PASSWORD_ENV]='Testing-password-123'
        for _ in range(2):
            for command in ['migrate','migrate-business']:
                subprocess.run(['php',str(root/'bin/console.php'),command],env=env,check=True,stdout=subprocess.DEVNULL)
        subprocess.run(['php',str(root/'bin/console.php'),'superadmin','admin'],env=env,check=True,stdout=subprocess.DEVNULL)
        duplicate=subprocess.run(['php',str(root/'bin/console.php'),'superadmin','second'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        check(duplicate.returncode==1,'CLI rejects second local superadmin')
        subprocess.run(['php',str(fixture),'seed'],env=env,check=True)
        site=pathlib.Path(tmp)/'site'
        deployment=site/'renamed'
        shutil.copytree(root,deployment,ignore=shutil.ignore_patterns('tests','*.sql'))
        for subpath,docroot in [('',deployment),('/renamed',site)]:
            sock=socket.socket(); sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]; sock.close()
            base='http://127.0.0.1:'+str(port)+subpath
            with open(pathlib.Path(tmp)/'server.log','w+') as log:
                server=subprocess.Popen(['php','-S','127.0.0.1:'+str(port),'-t',str(docroot)],env=env,stdout=log,stderr=log)
                for _ in range(50):
                    try: socket.create_connection(('127.0.0.1',port),timeout=.1).close(); break
                    except OSError: time.sleep(.1)
                flow()
                server.terminate(); server.wait(); server=None
                log.seek(0); logs=log.read()
                check('PHP Fatal error' not in logs and 'PHP Warning' not in logs,'HTTP flow without PHP warnings')
finally:
    if server: server.terminate(); server.wait()
    subprocess.run(['php',str(fixture),'clean'],env=env,check=True)
print(checks,'HTTP checks passed for',APP)
