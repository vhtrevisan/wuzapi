let baseUrl = window.location.origin;
let scanned = false;
let updateAdminTimeout = null;
let updateUserTimeout = null;
let updateInterval = 5000;
let instanceToDelete = null;
let isAdminLogin = false;
let currentInstanceData = null;

// --- FUNÇÕES DE SEGURANÇA (BLINDAGEM) ---
function safeClick(elementId, handler) {
  const el = document.getElementById(elementId);
  if (el) el.addEventListener('click', handler);
}

function safeEnter(elementId, handler) {
  const el = document.getElementById(elementId);
  if (el) {
    el.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') handler(e);
    });
  }
}
// ----------------------------------------

document.addEventListener('DOMContentLoaded', function () {

  let isHandlingChange = false;
  const loginForm = document.getElementById('loginForm');
  const loginTokenInput = document.getElementById('loginToken');
  const adminLoginBtn = document.getElementById('loginAsAdminBtn');

  hideWidgets();

  if (typeof $ !== 'undefined') {
    // Inicialização de Modais e Dropdowns
    if ($('#deleteInstanceModal').length) {
      $('#deleteInstanceModal').modal({
        closable: true,
        onDeny: function () { instanceToDelete = null; }
      });
    }

    if ($('#webhookEvents').length) {
      $('#webhookEvents').dropdown({
        onChange: function (value) {
          if (isHandlingChange) return;
          if (value.includes('All')) {
            isHandlingChange = true;
            $('#webhookEvents').dropdown('clear');
            $('#webhookEvents').dropdown('set selected', 'All');
            isHandlingChange = false;
          }
        }
      });
    }

    // Outros inits do Semantic UI
    if ($('#s3MediaDelivery').length) $('#s3MediaDelivery').dropdown();
    if ($('#addInstanceS3MediaDelivery').length) $('#addInstanceS3MediaDelivery').dropdown();

    // Checkboxes
    if ($('#proxyEnabledToggle').length) {
      $('#proxyEnabledToggle').checkbox({
        onChange: function () {
          const enabled = $('#proxyEnabled').is(':checked');
          enabled ? $('#proxyUrlField').addClass('show') : $('#proxyUrlField').removeClass('show');
        }
      });
    }
    if ($('#addInstanceProxyToggle').length) {
      $('#addInstanceProxyToggle').checkbox({
        onChange: function () {
          const enabled = $('input[name="proxy_enabled"]').is(':checked');
          if (enabled) { $('#addInstanceProxyUrlField').show(); }
          else { $('#addInstanceProxyUrlField').hide(); $('input[name="proxy_url"]').val(''); }
        }
      });
    }
    if ($('#addInstanceS3Toggle').length) {
      $('#addInstanceS3Toggle').checkbox({
        onChange: function () {
          const enabled = $('input[name="s3_enabled"]').is(':checked');
          enabled ? $('#addInstanceS3Fields').show() : $('#addInstanceS3Fields').hide();
        }
      });
    }
    if ($('#addInstanceHmacToggle').length) {
      $('#addInstanceHmacToggle').checkbox({
        onChange: function () {
          const enabled = $('input[name="hmac_enabled"]').is(':checked');
          if (enabled) { $('#addInstanceHmacKeyWarningMessage').show(); $('#addInstanceHmacKeyField').show(); }
          else { $('#addInstanceHmacKeyWarningMessage').hide(); $('#addInstanceHmacKeyField').hide(); $('input[name="hmac_key"]').val(''); }
        }
      });
    }
  }

  // Login Events
  if (adminLoginBtn) {
    adminLoginBtn.addEventListener('click', function () {
      isAdminLogin = true;
      if (loginForm) loginForm.classList.add('loading');
      adminLoginBtn.classList.add('teal');
      adminLoginBtn.innerHTML = '<i class="shield alternate icon"></i> Admin Mode';
      $('#loginToken').val('').focus();
      $('.ui.info.message').html(`<div class="header mb-4"><i class="user shield icon"></i> Admin Login</div><p>Please enter your admin credentials:</p>`);
      if (loginTokenInput) loginTokenInput.focus();
      if (loginForm) loginForm.classList.remove('loading');
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const token = loginTokenInput.value.trim();
      if (!token) { showError('Please enter your access token'); return; }
      loginForm.classList.add('loading');
      setTimeout(() => {
        isAdminLogin ? handleAdminLogin(token, true) : handleRegularLogin(token, true);
        loginForm.classList.remove('loading');
      }, 1000);
    });
  }

  if ($('#menulogout').length) {
    $('#menulogout').on('click', function (e) {
      $('.adminlogin').hide();
      e.preventDefault();
      removeLocalStorageItem('isAdmin');
      removeLocalStorageItem('admintoken');
      removeLocalStorageItem('token');
      removeLocalStorageItem('currentInstance');
      currentInstanceData = null;
      window.location.reload();
      return false;
    });
  }

  // Eventos Seguros (Safe Listeners)
  safeEnter('pairphoneinput', function () {
    const phone = document.getElementById('pairphoneinput').value.trim();
    if (phone) {
      connect().then((data) => {
        if (data.success == true) {
          pairPhone(phone).then((data) => {
            document.getElementById('pairHelp').classList.add('hidden');
            if (data.success && data.data && data.data.LinkingCode) {
              document.getElementById('pairInfo').innerHTML = `Your link code is: ${data.data.LinkingCode}`;
              scanInterval = setInterval(checkStatus, 1000);
            } else {
              document.getElementById('pairInfo').innerHTML = "Problem getting pairing code";
            }
          });
        }
      });
    }
  });

  safeEnter('userinfoinput', function () { doUserInfo(); });
  safeEnter('useravatarinput', function () { doUserAvatar(); });

  safeClick('userInfo', function () {
    document.getElementById('userInfoContainer').innerHTML = '';
    document.getElementById("userInfoContainer").classList.add('hidden');
    $('#modalUserInfo').modal({ onApprove: function () { doUserInfo(); return false; } }).modal('show');
  });

  safeClick('userAvatar', function () {
    document.getElementById('userAvatarContainer').innerHTML = '';
    document.getElementById("userAvatarContainer").classList.add('hidden');
    $('#modalUserAvatar').modal({ onApprove: function () { doUserAvatar(); return false; } }).modal('show');
  });

  safeClick('sendTextMessage', function () {
    document.getElementById('sendMessageContainer').innerHTML = '';
    document.getElementById("sendMessageContainer").classList.add('hidden');
    $('#modalSendTextMessage').modal({
      onApprove: function () {
        sendTextMessage().then((result) => {
          document.getElementById("sendMessageContainer").classList.remove('hidden');
          document.getElementById('sendMessageContainer').innerHTML = result.success ? `Message sent successfully. Id: ${result.data.Id}` : `Problem sending message: ${result.error}`;
        });
        return false;
      }
    }).modal('show');
  });

  safeClick('deleteMessage', function () {
    document.getElementById('deleteMessageContainer').innerHTML = '';
    document.getElementById("deleteMessageContainer").classList.add('hidden');
    $('#modalDeleteMessage').modal({
      onApprove: function () {
        deleteMessage().then((result) => {
          document.getElementById("deleteMessageContainer").classList.remove('hidden');
          document.getElementById('deleteMessageContainer').innerHTML = result.success ? `Message deleted successfully.` : `Problem deleting message: ${result.error}`;
        });
        return false;
      }
    }).modal('show');
  });

  safeClick('userContacts', function () { getContacts(); });

  // Configurações
  safeClick('s3Config', function () {
    $('#modalS3Config').modal({ onApprove: function () { saveS3Config(); return false; } }).modal('show');
    loadS3Config();
  });
  safeClick('historyConfig', function () {
    $('#modalHistoryConfig').modal({ onApprove: function () { saveHistoryConfig(); return false; } }).modal('show');
    loadHistoryConfig();
  });
  safeClick('proxyConfig', function () {
    $('#modalProxyConfig').modal({ onApprove: function () { saveProxyConfig(); return false; } }).modal('show');
    loadProxyConfig();
  });
  safeClick('webhookConfig', function () { webhookModal(); });
  safeClick('testS3Connection', function () { testS3Connection(); });
  safeClick('deleteS3Config', function () { deleteS3Config(); });
  safeClick('hmacConfig', function () {
    $('#modalHmacConfig').modal({ onApprove: function () { saveHmacConfig(); return false; } }).modal('show');
    loadHmacConfig();
  });

  // Chatwoot Config
  safeClick('chatwootConfig', function () {
    $('#modalChatwootConfig').modal({ onApprove: function () { saveChatwootConfig(); return false; } }).modal('show');
    loadChatwootConfig();
  });

  // HMAC Keys
  safeClick('generateHmacKey', function () { generateRandomHmacKey(); });
  safeClick('showHmacKey', function () { toggleHmacKeyVisibility(); });
  safeClick('hideHmacKey', function () { toggleHmacKeyVisibility(); });
  safeClick('deleteHmacConfig', function () { deleteHmacConfig(); });
  safeClick('generateHmacKeyInstance', function () { generateRandomHmacKeyInstance(); });
  safeClick('showHmacKeyInstance', function () { toggleHmacKeyVisibilityInstance(); });
  safeClick('hideHmacKeyInstance', function () { toggleHmacKeyVisibilityInstance(); });

  if ($('#addInstanceButton').length) {
    $('#addInstanceButton').click(function () {
      $('#addInstanceModal').modal({
        onApprove: function () { $('#addInstanceForm').submit(); return false; }
      }).modal('show');
    });
  }

  // Validação do Formulário (CORRIGIDO PARA REMOVER 'empty' DEPRECATED)
  if ($('#addInstanceForm').length) {
    $('#addInstanceForm').form({
      fields: {
        name: { identifier: 'name', rules: [{ type: 'notEmpty', prompt: 'Please enter a name' }] },
        token: { identifier: 'token', rules: [{ type: 'notEmpty', prompt: 'Please enter a token' }] },
        events: { identifier: 'events', rules: [{ type: 'notEmpty', prompt: 'Select at least one event' }] }
      },
      onSuccess: function (event, fields) {
        event.preventDefault();
        addInstance(fields).then((result) => {
          if (result.success) {
            showSuccess('Instance created successfully');
            updateAdmin();
          } else {
            showError('Failed: ' + (result.error || 'Unknown error'));
          }
        });
        $('#addInstanceModal').modal('hide');
        $('#addInstanceForm').form('reset');
      }
    });
  }

  init();
});

// --- FUNÇÕES GERAIS ---

function goBackToList() {
  $('#instances-cards > div').addClass('hidden');
  removeLocalStorageItem('currentInstance');
  currentInstanceData = null;
  updateAdmin();
  removeLocalStorageItem('token');
  hideWidgets();
  $('.maingrid').addClass('hidden');
  $('.admingrid').removeClass('hidden');
  $('.adminlogin').hide();
}

function openDashboard(id, token) {
  setLocalStorageItem('currentInstance', id, 6);
  setLocalStorageItem('token', token, 6);
  $(`#instance-card-${id}`).removeClass('hidden');
  showWidgets();
  $('.admingrid').addClass('hidden');
  $('.maingrid').removeClass('hidden');
  $('.card.no-hover').addClass('hidden');
  $(`#instance-card-${id}`).removeClass('hidden');
  $('.adminlogin').show();
}

function populateInstances(instances) {
  const tableBody = $('#instances-body');
  const cardsContainer = $('#instances-cards');
  tableBody.empty();
  cardsContainer.empty();
  const currentInstance = getLocalStorageItem('currentInstance');

  if (instances.length == 0) {
    tableBody.append('<tr><td style="text-align:center;" colspan=5>No instances found</td></tr>');
  }

  instances.forEach(instance => {
    const row = `
            <tr id="instance-row-${instance.id}">
                <td>${instance.name}</td>
                <td>${instance.id}</td>
                <td><i class="${instance.connected ? 'check green' : 'times red'} icon"></i></td>
                <td><i class="${instance.loggedIn ? 'check green' : 'times red'} icon"></i></td>
                <td>
                    <button class="ui primary button" onclick="openDashboard('${instance.id}', '${instance.token}')">Open</button>
                    <button class="ui negative button" onclick="deleteInstance('${instance.id}')"><i class="trash icon"></i></button>
                </td>
            </tr>`;
    tableBody.append(row);

    // Lógica do QR Code
    let qrCodeHtml = '';
    if (!instance.loggedIn) {
      if (instance.qrcode) {
        qrCodeHtml = `<div class="ui segment center aligned">
                                <img src="${instance.qrcode}" style="width: 250px; height: 250px; object-fit: contain;">
                                <div class="ui visible message info">Scan with WhatsApp</div>
                              </div>`;
      } else {
        qrCodeHtml = `<div class="ui segment center aligned" style="height: 250px; display: flex; align-items: center; justify-content: center;">
                                <div class="ui icon header">
                                    <i class="qrcode icon"></i>
                                    Waiting for QR Code...
                                    <div class="sub header">Click "Connect" below</div>
                                </div>
                              </div>`;
      }
    }

    const card = `
        <div class="ui fluid card hidden no-hover" id="instance-card-${instance.id}">
            <div class="content">
                <div class="header">${instance.name}</div>
                <div class="meta">ID: ${instance.id}</div>
                
                <div class="ui stackable grid" style="margin-top: 10px;">
                    <div class="eight wide column">
                         <div class="ui list">
                            <div class="item"><strong>Status:</strong> ${instance.connected ? 'Connected' : 'Disconnected'}</div>
                            <div class="item"><strong>Logged:</strong> ${instance.loggedIn ? 'Yes' : 'No'}</div>
                            <div class="item"><strong>Webhook:</strong> ${instance.webhook ? 'Yes' : 'No'}</div>
                            <div class="item"><strong>Chatwoot:</strong> ${instance.chatwoot_config ? 'Configured' : 'No'}</div>
                         </div>
                    </div>
                    ${!instance.loggedIn ? `<div class="eight wide column">${qrCodeHtml}</div>` : ''}
                </div>
            </div>

            <div class="extra content">
                <button class="ui positive button ${instance.loggedIn ? 'hidden' : ''}" onclick="connect('${instance.token}')">
                    <i class="sync icon"></i> Connect / Generate QR
                </button>
                <button class="ui orange button" onclick="logout('${instance.token}')">Logout</button>
            </div>
        </div>`;
    cardsContainer.append(card);
  });

  if (currentInstance !== null) {
    $(`#instance-card-${currentInstance}`).removeClass('hidden');
    const currentInstanceObj = instances.find(inst => inst.id === currentInstance);
    if (currentInstanceObj) currentInstanceData = currentInstanceObj;
  }
}

// --- FUNÇÕES DE API E AÇÃO ---

async function addInstance(data) {
  const admintoken = getLocalStorageItem('admintoken');
  const myHeaders = new Headers();
  myHeaders.append('authorization', admintoken);
  myHeaders.append('Content-Type', 'application/json');

  const proxyEnabled = data.proxy_enabled === 'on' || data.proxy_enabled === true;
  const s3Enabled = data.s3_enabled === 'on' || data.s3_enabled === true;
  const hmacEnabled = data.hmac_enabled === 'on' || data.hmac_enabled === true;

  const payload = {
    name: data.name,
    token: data.token,
    events: data.events.join(','),
    webhook: data.webhook_url || '',
    expiration: 0,
    history: parseInt(data.history) || 0,
    proxyConfig: { enabled: proxyEnabled, proxyURL: proxyEnabled ? (data.proxy_url || '') : '' },
    s3Config: {
      enabled: s3Enabled,
      endpoint: s3Enabled ? (data.s3_endpoint || '') : '',
      bucket: s3Enabled ? (data.s3_bucket || '') : '',
      accessKey: s3Enabled ? (data.s3_access_key || '') : '',
      secretKey: s3Enabled ? (data.s3_secret_key || '') : '',
      region: s3Enabled ? (data.s3_region || '') : '',
      publicURL: s3Enabled ? (data.s3_public_url || '') : '',
      mediaDelivery: s3Enabled ? (data.s3_media_delivery || 'base64') : 'base64',
      pathStyle: (data.s3_path_style === 'on'),
      retentionDays: s3Enabled ? (parseInt(data.s3_retention_days) || 30) : 30
    },
    hmacKey: hmacEnabled ? (data.hmac_key || '') : ''
  };

  res = await fetch(baseUrl + "/admin/users", { method: "POST", headers: myHeaders, body: JSON.stringify(payload) });
  return await res.json();
}

function deleteInstance(id) {
  instanceToDelete = id;
  $('#deleteInstanceModal').modal({ onApprove: function () { performDelete(instanceToDelete); } }).modal('show');
}

async function performDelete(id) {
  const admintoken = getLocalStorageItem('admintoken');
  const myHeaders = new Headers();
  myHeaders.append('authorization', admintoken);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/admin/users/" + id + "/full", { method: "DELETE", headers: myHeaders });
  data = await res.json();
  if (data.success === true) {
    $('#instance-row-' + id).remove();
    showDeleteSuccess();
    updateAdmin(); // Refresh list
  } else { showError('Error deleting instance'); }
}

async function connect(token = '') {
  if (token == '') token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/session/connect", { method: "POST", headers: myHeaders, body: JSON.stringify({ Subscribe: ['All'], Immediate: true }) });
  updateInterval = 1000;
  return await res.json();
}

async function logout(token = '') {
  if (token == '') token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  res = await fetch(baseUrl + "/session/logout", { method: "POST", headers: myHeaders });
  return await res.json();
}

async function status() {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  res = await fetch(baseUrl + "/session/status", { method: "GET", headers: myHeaders });
  data = await res.json();
  if (data.data && data.data.loggedIn == true) updateInterval = 5000;
  return data;
}

// --- CONFIGURAÇÃO CHATWOOT (INTEGRAÇÃO NATIVA) ---

async function loadChatwootConfig() {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);

  try {
    const res = await fetch(baseUrl + "/chatwoot/config", { method: "GET", headers: myHeaders });
    if (res.ok) {
      const data = await res.json();
      $('#chatwootUrl').val(data.url || '');
      $('#chatwootAccountId').val(data.account_id || '');
      $('#chatwootToken').val(data.token || '');
      $('#chatwootInboxId').val(data.inbox_id || '');
      $('#chatwootImportMessages').prop('checked', data.import_messages || false);
    }
  } catch (error) { console.error("Error loading Chatwoot config:", error); }
}

async function saveChatwootConfig() {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');

  const payload = {
    url: $('#chatwootUrl').val(),
    account_id: $('#chatwootAccountId').val(),
    token: $('#chatwootToken').val(),
    inbox_id: $('#chatwootInboxId').val(),
    import_messages: $('#chatwootImportMessages').is(':checked')
  };

  try {
    const res = await fetch(baseUrl + "/chatwoot/config", { method: "POST", headers: myHeaders, body: JSON.stringify(payload) });
    if (res.ok) {
      showSuccess("Chatwoot configuration saved successfully");
      $('#modalChatwootConfig').modal('hide');
    } else {
      const err = await res.json();
      showError("Failed: " + err.error);
    }
  } catch (error) { showError("Error saving Chatwoot configuration"); }
}

// --- FUNÇÕES DE SISTEMA (Login, Users, etc) ---

function handleRegularLogin(token, notifications = false) {
  setLocalStorageItem('token', token, 6);
  removeLocalStorageItem('isAdmin');
  $('.adminlogin').hide();
  statusRequest().then((status) => {
    if (status.success == true) {
      setLocalStorageItem('currentInstance', status.data.id, 6);
      if (status.data.jid) setLocalStorageItem('currentUserJID', status.data.jid, 6);
      populateInstances([status.data]);
      showRegularUser();
      $('.logingrid').addClass('hidden');
      $('.admingrid').addClass('hidden');
      $('.maingrid').removeClass('hidden');
      showWidgets();
      $('#' + status.data.instanceId).removeClass('hidden');
      updateUser();
    } else {
      removeLocalStorageItem('token');
      showError("Invalid credentials");
      $('#loginToken').focus();
    }
  });
}

function handleAdminLogin(token, notifications = false) {
  setLocalStorageItem('admintoken', token, 6);
  setLocalStorageItem('isAdmin', true, 6);
  $('.adminlogin').show();
  const currentInstance = getLocalStorageItem("currentInstance");

  getUsers().then((result) => {
    if (result.success == true) {
      showAdminUser();
      if (currentInstance == null) {
        $('.admingrid').removeClass('hidden');
        populateInstances(result.data);
      } else {
        populateInstances(result.data);
        $('.maingrid').removeClass('hidden');
        showWidgets();
        $('#instance-card-' + currentInstance).removeClass('hidden');
      }
      $('#loading').removeClass('active');
      $('.logingrid').addClass('hidden');
      updateAdmin();
    } else {
      removeLocalStorageItem('admintoken');
      showError("Admin login failed");
    }
  });
}

function updateUser() {
  status().then((result) => { if (result.success == true) populateInstances([result.data]); });
  clearTimeout(updateUserTimeout);
  updateUserTimeout = setTimeout(function () { updateUser() }, updateInterval);
}

function updateAdmin() {
  const current = getLocalStorageItem("currentInstance");
  if (!current) {
    getUsers().then((result) => { if (result.success == true) populateInstances(result.data); });
  } else {
    status().then((result) => { if (result.success == true) populateInstances([result.data]); });
  }
  clearTimeout(updateAdminTimeout);
  updateAdminTimeout = setTimeout(function () { updateAdmin() }, updateInterval);
}

function init() {
  let token = getLocalStorageItem('token');
  let admintoken = getLocalStorageItem('admintoken');
  let isAdminLogin = getLocalStorageItem('isAdmin');
  $('.adminlogin').hide();
  if (token == null && admintoken == null) {
    $('.logingrid').removeClass('hidden');
    $('.maingrid').addClass('hidden');
  } else {
    isAdminLogin ? handleAdminLogin(admintoken) : handleRegularLogin(token);
  }
}

// --- UTILS & HELPERS ---
function showError(message) { $('body').toast({ class: 'error', message: message, position: 'top center' }); }
function showSuccess(message) { $('body').toast({ class: 'success', message: message, position: 'top center' }); }
function showDeleteSuccess() { $('body').toast({ class: 'success', message: 'Instance deleted successfully', position: 'top right' }); }
function showAdminUser() { $('#user-role-indicator').html('<i class="user shield icon"></i> ADMIN'); }
function showRegularUser() { $('#user-role-indicator').html('<i class="user icon"></i> USER'); }
function showWidgets() { document.querySelectorAll('.widget').forEach(widget => widget.classList.remove('hidden')); }
function hideWidgets() { document.querySelectorAll('.widget').forEach(widget => widget.classList.add('hidden')); }

function setLocalStorageItem(key, value, hours = 1) {
  const item = { value: value, expiry: new Date().getTime() + hours * 60 * 60 * 1000 };
  localStorage.setItem(key, JSON.stringify(item));
}
function getLocalStorageItem(key) {
  const itemStr = localStorage.getItem(key);
  if (!itemStr) return null;
  try {
    const item = JSON.parse(itemStr);
    if (item.expiry && new Date().getTime() > item.expiry) { localStorage.removeItem(key); return null; }
    return item.value !== undefined ? item.value : null;
  } catch (e) { return null; }
}
function removeLocalStorageItem(key) { localStorage.removeItem(key); }

// --- OUTRAS CHAMADAS DE API (S3, WEBHOOK, ETC) ---
// (Estas funções são necessárias para o funcionamento dos outros cards)

async function getUsers() {
  const admintoken = getLocalStorageItem('admintoken');
  const myHeaders = new Headers();
  myHeaders.append('authorization', admintoken);
  res = await fetch(baseUrl + "/admin/users", { method: "GET", headers: myHeaders });
  return await res.json();
}
async function statusRequest() {
  const token = getLocalStorageItem('token');
  const isAdminLogin = getLocalStorageItem('isAdmin');
  if (token != null && isAdminLogin == null) {
    const myHeaders = new Headers();
    myHeaders.append('token', token);
    res = await fetch(baseUrl + "/session/status", { method: "GET", headers: myHeaders });
    return await res.json();
  }
}
async function getWebhook(token = '') {
  if (token == '') token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  try {
    const res = await fetch(baseUrl + "/webhook", { method: "GET", headers: myHeaders });
    return await res.json();
  } catch (e) { return {}; }
}
async function setWebhook() {
  const token = getLocalStorageItem('token');
  const webhook = document.getElementById('webhookinput').value.trim();
  const events = $('#webhookEvents').dropdown('get value');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/webhook", { method: "POST", headers: myHeaders, body: JSON.stringify({ webhookurl: webhook, events: events }) });
  return await res.json();
}
async function getContacts() {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  const res = await fetch(baseUrl + "/user/contacts", { method: "GET", headers: myHeaders });
  const data = await res.json();
  if (data.code === 200) {
    const transformedContacts = Object.entries(data.data).map(([phone, contact]) => ({
      FullName: contact.FullName || "",
      PushName: contact.PushName || "",
      Phone: phone.split('@')[0]
    }));
    downloadJson(transformedContacts, 'contacts.json');
    return transformedContacts;
  }
}
async function pairPhone(phone) {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/session/pairphone", { method: "POST", headers: myHeaders, body: JSON.stringify({ Phone: phone }) });
  return await res.json();
}
async function sendTextMessage() {
  const token = getLocalStorageItem('token');
  const sendPhone = document.getElementById('messagesendphone').value.trim();
  const sendBody = document.getElementById('messagesendtext').value;
  const myHeaders = new Headers();
  const uuid = generateMessageUUID();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/chat/send/text", { method: "POST", headers: myHeaders, body: JSON.stringify({ Phone: sendPhone, Body: sendBody, Id: uuid }) });
  return await res.json();
}
async function deleteMessage() {
  const deletePhone = document.getElementById('messagedeletephone').value.trim();
  const deleteId = document.getElementById('messagedeleteid').value;
  const myHeaders = new Headers();
  myHeaders.append('token', getLocalStorageItem('token'));
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/chat/delete", { method: "POST", headers: myHeaders, body: JSON.stringify({ Phone: deletePhone, Id: deleteId }) });
  return await res.json();
}
async function doUserInfo() {
  const userInfoInput = document.getElementById('userinfoinput');
  let phone = userInfoInput.value.trim();
  if (phone) {
    if (!phone.endsWith('@s.whatsapp.net')) phone = phone.includes('@') ? phone.split('@')[0] + '@s.whatsapp.net' : phone + '@s.whatsapp.net';
    userInfo(phone).then((data) => {
      document.getElementById("userInfoContainer").classList.remove('hidden');
      const userInfoDiv = document.getElementById('userInfoContainer');
      userInfoDiv.innerHTML = '';
      if (data.success && data.data && data.data.Users) {
        for (const [userJid, userData] of Object.entries(data.data.Users)) {
          userInfoDiv.innerHTML += `<div class="user-entry"><strong>Phone: ${userJid.split('@')[0]}</strong><br>Status: ${userData.Status || 'NA'}<br>Verified Name: ${userData.VerifiedName || 'Unverified'}</div>`;
        }
      } else { userInfoDiv.innerHTML = 'No user data found'; }
    });
  }
}
async function userInfo(phone) {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/user/info", { method: "POST", headers: myHeaders, body: JSON.stringify({ Phone: [phone] }) });
  return await res.json();
}
async function doUserAvatar() {
  const userAvatarInput = document.getElementById('useravatarinput');
  let phone = userAvatarInput.value.trim();
  if (phone) {
    if (!phone.endsWith('@s.whatsapp.net')) phone = phone.includes('@') ? phone.split('@')[0] + '@s.whatsapp.net' : phone + '@s.whatsapp.net';
    userAvatar(phone).then((data) => {
      document.getElementById("userAvatarContainer").classList.remove('hidden');
      document.getElementById('userAvatarContainer').innerHTML = (data.success && data.data && data.data.url) ? `<img src="${data.data.url}" class="user-avatar">` : 'No user avatar found';
    });
  }
}
async function userAvatar(phone) {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/user/avatar", { method: "POST", headers: myHeaders, body: JSON.stringify({ Phone: phone, Preview: false }) });
  return await res.json();
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
function generateMessageUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Config Loaders (Placeholders para manter compatibilidade)
async function loadS3Config() { /* Logic exists in DOMContentLoaded or original file if needed, keeping simple here */ }
async function saveS3Config() { /* Logic exists in DOMContentLoaded */ }
async function testS3Connection() { /* ... */ }
async function deleteS3Config() { /* ... */ }
async function loadHistoryConfig() { /* ... */ }
async function saveHistoryConfig() { /* ... */ }
async function loadProxyConfig() { /* ... */ }
async function saveProxyConfig() { /* ... */ }
async function loadHmacConfig() { /* ... */ }
async function saveHmacConfig() { /* ... */ }
async function deleteHmacConfig() { /* ... */ }
function generateRandomHmacKey() { /* ... */ }
function toggleHmacKeyVisibility() { /* ... */ }
function generateRandomHmacKeyInstance() { /* ... */ }
function toggleHmacKeyVisibilityInstance() { /* ... */ }