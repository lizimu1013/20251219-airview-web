import os
import json
import requests
from flask import Flask, redirect, url_for, session, render_template, request
from flask_cors import CORS
from authlib.integrations.flask_client import OAuth

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)
CORS(app)  # 启用CORS支持

# OAuth配置（推荐从环境变量读取，生产环境更安全）
# app.config['CLIENT_ID'] = os.environ.get('CLIENT_ID', '')
# app.config['CLIENT_SECRET'] = os.environ.get('CLIENT_SECRET', '')
CLIENT_ID = 'airview_login'
CLIENT_SECRET = 'airview_admin'


USERINFO_URL = 'https://uniportal.huawei.com/saaslogin1/oauth2/userinfo'
ACCESS_TOKEN_URL = 'https://uniportal.huawei.com/saaslogin1/oauth2/accesstoken'
REFRESH_TOKEN_URL = 'https://uniportal.huawei.com/saaslogin1/oauth2/refreshtoken'
AUTHORIZE_URL = 'https://uniportal.huawei.com/saaslogin1/oauth2/authorize'
SCOPE = 'base.profile'
REDIRECT_URI = 'https://airview.rnd.huawei.com/authorize'  # 与授权时一致
LOGOUT_URL = "https://uniportal.huawei.com/saaslogin1/oauth2/logout"

# OAuth初始化
oauth = OAuth(app)
oauth.register(
    name='w3',
    client_id=CLIENT_ID,
    client_secret=CLIENT_SECRET,
    access_token_url=ACCESS_TOKEN_URL,
    authorize_url=AUTHORIZE_URL,
    client_kwargs={'scope': SCOPE},
    redirect_uri=REDIRECT_URI,
)


@app.route('/')
def index():
    return render_template('login.html')


@app.route('/login')
def login():
    return render_template('login.html')


@app.route('/logout')
def logout():
    # 1. 清除本地 session
    session.clear()

    # 2. 构造认证平台登出URL
    params = {
        "clientId": CLIENT_ID,
        "redirect": url_for('login', _external=True)
    }
    # 也可用 requests.compat.urlencode(params) 拼接参数
    from urllib.parse import urlencode
    logout_url = f"{LOGOUT_URL}?{urlencode(params)}"

    # 3. 跳转到统一登出
    return redirect(logout_url)


@app.route('/authorize')
def authorize():
    # 认证平台回调，带 code，后端换 token
    code = request.args.get('code')
    if not code:
        # 没有 code 时，说明是首次访问 /authorize，用于跳转到认证平台
        return oauth.w3.authorize_redirect(REDIRECT_URI)
    # 有 code 时，说明是认证平台回调，用 code 换 token
    data = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
        "code": code
    }
    headers = {'Content-Type': 'application/json'}
    resp = requests.post(ACCESS_TOKEN_URL, headers=headers, data=json.dumps(data))
    if resp.status_code != 200:
        return f"获取令牌失败: {resp.text}", 400

    token = resp.json()
    if "access_token" not in token:
        return f"获取令牌失败: {token}", 400

    session['access_token'] = token['access_token']
    session['refresh_token'] = token.get('refresh_token')
    return redirect(url_for('welcome'))


@app.route('/welcome')
def welcome():
    return render_template('index.html')


@app.route('/profile')
def profile():
    access_token = session.get('access_token')
    if not access_token:
        return redirect(url_for('index'))
    payload = {
        "client_id": CLIENT_ID,
        "access_token": access_token,
        "scope": SCOPE
    }
    resp = requests.post(
        USERINFO_URL,
        headers={'Content-Type': 'application/json'},
        data=json.dumps(payload)
    )
    if resp.status_code != 200:
        return f"获取用户信息失败: {resp.text}", 400
    userinfo = resp.json()
    return render_template('profile.html', userinfo=userinfo)


@app.route('/refresh')
def refresh_token():
    refresh_token = session.get('refresh_token')
    if not refresh_token:
        msg = "没有 refresh_token"
        success = False
    else:
        payload = {
            "client_id": CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }
        resp = requests.post(
            REFRESH_TOKEN_URL,
            headers={'Content-Type': 'application/json'},
            data=json.dumps(payload)
        )
        data = resp.json()
        if 'access_token' in data:
            session['access_token'] = data['access_token']
            session['refresh_token'] = data.get('refresh_token')
            msg = f"刷新成功! 新 access_token: {data['access_token']}"
            success = True
        else:
            msg = f"刷新失败: {data}"
            success = False
    return render_template('refresh_result.html', message=msg, success=success)


# 可选：支持 /index.html 兼容访问
@app.route('/index.html')
def index_html():
    return render_template('index.html')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)

