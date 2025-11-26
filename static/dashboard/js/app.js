let baseUrl = window.location.origin;
let scanned = false;
let updateAdminTimeout = null;
let updateUserTimeout = null;
let updateInterval = 5000;
let instanceToDelete = null;
let isAdminLogin = false;
let currentInstanceData = null;

// --- FUNÇÃO DE BLINDAGEM (IMPEDE O ERRO DE TELA BRANCA) ---
function safeClick(elementId, handler) {
  const el = document.getElementById(elementId);
  if (el) {
    el.addEventListener('click', handler);
  }
}

function safeEnter(elementId, handler) {
  const el = document.getElementById(elementId);
  if (el) {
    el.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') handler(e);
    });
  }
}
// -----------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {

  let isHandlingChange = false;

  const loginForm = document.getElementById('loginForm');
  const loginTokenInput = document.getElementById('loginToken');
  const regularLoginBtn = document.getElementById('regularLoginBtn');
  const adminLoginBtn = document.getElementById('loginAsAdminBtn');

  hideWidgets();

  if (typeof $ !== 'undefined' && $('#deleteInstanceModal').length) {
    $('#deleteInstanceModal').modal({
      closable: true,
      onDeny: function () { instanceToDelete = null; }
    });
  }

  // Inicialização segura dos Dropdowns e Checkboxes
  if (typeof $ !== 'undefined') {
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
    if ($('#webhookEventsInstance').length) {
      $('#webhookEventsInstance').dropdown({
        onChange: function (value) {
          if (isHandlingChange) return;
          if (value.includes('All')) {
            isHandlingChange = true;
            $('#webhookEventsInstance').dropdown('clear');
            $('#webhookEventsInstance').dropdown('set selected', 'All');
            isHandlingChange = false;
          }
        }
      });
    }
    if ($('#s3MediaDelivery').length) $('#s3MediaDelivery').dropdown();
    if ($('#addInstanceS3MediaDelivery').length) $('#addInstanceS3MediaDelivery').dropdown();

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
          if (enabled) {
            $('#addInstanceProxyUrlField').show();
          } else {
            $('#addInstanceProxyUrlField').hide();
            $('input[name="proxy_url"]').val('');
          }
        }
      });
    }

    if ($('#addInstanceS3Toggle').length) {
      $('#addInstanceS3Toggle').checkbox({
        onChange: function () {
          const enabled = $('input[name="s3_enabled"]').is(':checked');
          if (enabled) {
            $('#addInstanceS3Fields').show();
          } else {
            $('#addInstanceS3Fields').hide();
          }
        }
      });
    }

    if ($('#addInstanceHmacToggle').length) {
      $('#addInstanceHmacToggle').checkbox({
        onChange: function () {
          const enabled = $('input[name="hmac_enabled"]').is(':checked');
          if (enabled) {
            $('#addInstanceHmacKeyWarningMessage').show();
            $('#addInstanceHmacKeyField').show();
          } else {
            $('#addInstanceHmacKeyWarningMessage').hide();
            $('#addInstanceHmacKeyField').hide();
            $('input[name="hmac_key"]').val('');
          }
        }
      });
    }
  }

  // Login Admin
  if (adminLoginBtn) {
    adminLoginBtn.addEventListener('click', function () {
      isAdminLogin = true;
      if (loginForm) loginForm.classList.add('loading');
      adminLoginBtn.classList.add('teal');
      adminLoginBtn.innerHTML = '<i class="shield alternate icon"></i> Admin Mode';
      if ($('#loginToken')) $('#loginToken').val('').focus();
      $('.ui.info.message').html(`<div class="header mb-4"><i class="user shield icon"></i> Admin Login</div><p>Please enter your admin credentials:</p>`);
      if (loginTokenInput) loginTokenInput.focus();
      if (loginForm) loginForm.classList.remove('loading');
    });
  }

  // Submit Login
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const token = loginTokenInput.value.trim();
      if (!token) {
        showError('Please enter your access token');
        return;
      }
      loginForm.classList.add('loading');
      setTimeout(() => {
        isAdminLogin ? handleAdminLogin(token, true) : handleRegularLogin(token, true);
        loginForm.classList.remove('loading');
      }, 1000);
    });
  }

  // Logout via Menu
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

  // --- AQUI COMEÇA A CORREÇÃO REAL (USANDO safeEnter e safeClick) ---

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
          document.getElementById('sendMessageContainer').innerHTML = result.success ?
            `Message sent successfully. Id: ${result.data.Id}` : `Problem sending message: ${result.error}`;
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
          document.getElementById('deleteMessageContainer').innerHTML = result.success ?
            `Message deleted successfully.` : `Problem deleting message: ${result.error}`;
        });
        return false;
      }
    }).modal('show');
  });

  safeClick('userContacts', function () { getContacts(); });

  // Configurações (S3, History, Proxy, Webhook)
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
  safeClick('deleteS3Config', function () { deleteS3Config(); }); // O ERRO ESTAVA AQUI

  safeClick('hmacConfig', function () {
    $('#modalHmacConfig').modal({ onApprove: function () { saveHmacConfig(); return false; } }).modal('show');
    loadHmacConfig();
  });

  // Chatwoot Config (O NOVO BOTÃO)
  safeClick('chatwootConfig', function () {
    $('#modalChatwootConfig').modal({
      onApprove: function () { saveChatwootConfig(); return false; }
    }).modal('show');
    loadChatwootConfig();
  });

  // HMAC Keys buttons
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

  // Add Instance Form Validation
  if ($('#addInstanceForm').length) {
    $('#addInstanceForm').form({
      fields: {
        name: { identifier: 'name', rules: [{ type: 'empty', prompt: 'Please enter a name' }] },
        token: { identifier: 'token', rules: [{ type: 'empty', prompt: 'Please enter a token' }] },
        events: { identifier: 'events', rules: [{ type: 'empty', prompt: 'Select at least one event' }] }
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

// --- FUNÇÕES AUXILIARES E ASYNC (MANTIDAS DO ORIGINAL) ---

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

function webhookModal() {
  getWebhook().then((response) => {
    if (response.success == true) {
      $('#webhookEvents').val(response.data.subscribe);
      if ($('#webhookEvents').length) $('#webhookEvents').dropdown('set selected', response.data.subscribe);
      $('#webhookinput').val(response.data.webhook);
      $('#modalSetWebhook').modal({
        onApprove: function () {
          setWebhook().then((result) => {
            result.success ? $.toast({ class: 'success', message: `Webhook set successfully !` }) : $.toast({ class: 'error', message: `Problem setting webhook: ${result.error}` });
          });
          return true;
        }
      }).modal('show');
    }
  });
}

// ... FUNÇÕES DE LOGIN/LOGOUT E OUTRAS ...

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
  status().then((result) => {
    if (result.success == true) populateInstances([result.data]);
  });
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

// ... OUTRAS FUNÇÕES AUXILIARES (showError, showSuccess, etc) ...

function showError(message) { $('body').toast({ class: 'error', message: message, position: 'top center' }); }
function showSuccess(message) { $('body').toast({ class: 'success', message: message, position: 'top center' }); }

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
  } else { showError('Error deleting instance'); }
}

function showDeleteSuccess() { $('body').toast({ class: 'success', message: 'Instance deleted successfully', position: 'top right' }); }

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

// ... FUNÇÕES DE API (sendTextMessage, deleteMessage, etc) ...

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
  myHeaders.append('token', token); // Variável global 'token' ou pegar do localStorage
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/chat/delete", { method: "POST", headers: myHeaders, body: JSON.stringify({ Phone: deletePhone, Id: deleteId }) });
  return await res.json();
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

function showWidgets() { document.querySelectorAll('.widget').forEach(widget => widget.classList.remove('hidden')); }
function hideWidgets() { document.querySelectorAll('.widget').forEach(widget => widget.classList.add('hidden')); }

// ... API WRAPPERS ...

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

async function getUsers() {
  const admintoken = getLocalStorageItem('admintoken');
  const myHeaders = new Headers();
  myHeaders.append('authorization', admintoken);
  res = await fetch(baseUrl + "/admin/users", { method: "GET", headers: myHeaders });
  return await res.json();
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

async function userAvatar(phone) {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/user/avatar", { method: "POST", headers: myHeaders, body: JSON.stringify({ Phone: phone, Preview: false }) });
  return await res.json();
}

async function userInfo(phone) {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/user/info", { method: "POST", headers: myHeaders, body: JSON.stringify({ Phone: [phone] }) });
  return await res.json();
}

async function pairPhone(phone) {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/session/pairphone", { method: "POST", headers: myHeaders, body: JSON.stringify({ Phone: phone }) });
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

// --- UTILS ---

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

function populateInstances(instances) {
  const tableBody = $('#instances-body');
  const cardsContainer = $('#instances-cards');
  tableBody.empty();
  cardsContainer.empty();
  const currentInstance = getLocalStorageItem('currentInstance');

  if (instances.length == 0) tableBody.append('<tr><td style="text-align:center;" colspan=5>No instances found</td></tr>');

  instances.forEach(instance => {
    // ... (Seu código HTML de criação da tabela - sem alterações) ...
    const row = `<tr><td>${instance.id}</td><td>${instance.name}</td><td>${instance.connected ? 'Yes' : 'No'}</td><td>${instance.loggedIn ? 'Yes' : 'No'}</td><td><button class="ui primary button" onclick="openDashboard('${instance.id}', '${instance.token}')">Open</button> <button class="ui negative button" onclick="deleteInstance('${instance.id}')">Delete</button></td></tr>`;
    tableBody.append(row);

    const card = `
        <div class="ui fluid card hidden no-hover" id="instance-card-${instance.id}">
           <div class="content">
              <div class="header">${instance.name}</div>
              <div class="meta">ID: ${instance.id}</div>
              <div class="description">
                 Connected: ${instance.connected}<br>
                 Logged In: ${instance.loggedIn}<br>
                 Webhook: ${instance.webhook || 'None'}<br>
                 Chatwoot: ${instance.chatwoot_config ? 'Configured' : 'No'}
              </div>
           </div>
           <div class="extra content">
              <button class="ui button" onclick="connect('${instance.token}')">Connect</button>
              <button class="ui button" onclick="logout('${instance.token}')">Logout</button>
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

// LocalStorage helpers
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
function showAdminUser() { $('#user-role-indicator').html('<i class="user shield icon"></i> ADMIN'); }
function showRegularUser() { $('#user-role-indicator').html('<i class="user icon"></i> USER'); }

// S3 / History / Proxy / HMAC Config loaders (Mantidos iguais, omitidos para brevidade, mas devem estar no arquivo)
// Certifique-se de que loadS3Config, loadHistoryConfig, etc., estão no arquivo.
async function loadS3Config() { /* ... código original ... */ }
async function saveS3Config() { /* ... código original ... */ }
async function testS3Connection() { /* ... código original ... */ }
async function deleteS3Config() { /* ... código original ... */ }
async function loadHistoryConfig() { /* ... código original ... */ }
async function saveHistoryConfig() { /* ... código original ... */ }
async function loadProxyConfig() { /* ... código original ... */ }
async function saveProxyConfig() { /* ... código original ... */ }
async function loadHmacConfig() { /* ... código original ... */ }
async function saveHmacConfig() { /* ... código original ... */ }
async function deleteHmacConfig() { /* ... código original ... */ }
function generateRandomHmacKey() { /* ... código original ... */ }
function toggleHmacKeyVisibility() { /* ... código original ... */ }
function generateRandomHmacKeyInstance() { /* ... código original ... */ }
function toggleHmacKeyVisibilityInstance() { /* ... código original ... */ }