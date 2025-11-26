let baseUrl = window.location.origin;
let scanned = false;
let updateAdminTimeout = null;
let updateUserTimeout = null;
let updateInterval = 5000;
let instanceToDelete = null;
let isAdminLogin = false;
let currentInstanceData = null;

// Helper function to safely add event listeners without crashing
function safeEventListener(id, event, handler) {
  const element = document.getElementById(id);
  if (element) {
    element.addEventListener(event, handler);
  }
}

document.addEventListener('DOMContentLoaded', function () {

  let isHandlingChange = false;

  const loginForm = document.getElementById('loginForm');
  const loginTokenInput = document.getElementById('loginToken');
  const regularLoginBtn = document.getElementById('regularLoginBtn');
  const adminLoginBtn = document.getElementById('loginAsAdminBtn');

  hideWidgets();

  if ($('#deleteInstanceModal').length) {
    $('#deleteInstanceModal').modal({
      closable: true,
      onDeny: function () {
        instanceToDelete = null;
      }
    });
  }

  // Initialize dropdowns safely
  if ($('#webhookEvents').length) {
    $('#webhookEvents').dropdown({
      onChange: function (value, text, $selectedItem) {
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
      onChange: function (value, text, $selectedItem) {
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

  // Initialize dropdowns
  if ($('#s3MediaDelivery').length) $('#s3MediaDelivery').dropdown();
  if ($('#addInstanceS3MediaDelivery').length) $('#addInstanceS3MediaDelivery').dropdown();

  // Initialize checkbox toggles
  if ($('#proxyEnabledToggle').length) {
    $('#proxyEnabledToggle').checkbox({
      onChange: function () {
        const enabled = $('#proxyEnabled').is(':checked');
        if (enabled) {
          $('#proxyUrlField').addClass('show');
        } else {
          $('#proxyUrlField').removeClass('show');
        }
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
          $('input[name="s3_endpoint"]').val('');
          $('input[name="s3_access_key"]').val('');
          $('input[name="s3_secret_key"]').val('');
          $('input[name="s3_bucket"]').val('');
          $('input[name="s3_region"]').val('');
          $('input[name="s3_public_url"]').val('');
          $('input[name="s3_retention_days"]').val('30');
          $('input[name="s3_path_style"]').prop('checked', false);
          $('#addInstanceS3MediaDelivery').dropdown('set selected', 'base64');
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

  // Handle admin login button click
  if (adminLoginBtn) {
    adminLoginBtn.addEventListener('click', function () {
      isAdminLogin = true;
      if (loginForm) loginForm.classList.add('loading');

      adminLoginBtn.classList.add('teal');
      adminLoginBtn.innerHTML = '<i class="shield alternate icon"></i> Admin Mode';
      $('#loginToken').val('').focus();

      $('.ui.info.message').html(`
        <div class="header mb-4">
            <i class="user shield icon"></i>
            Admin Login
        </div>
        <p>Please enter your admin credentials:</p>
        <ul>
            <li>Use your admin token in the field above</li>
        </ul>
    `);

      if (loginTokenInput) loginTokenInput.focus();
      if (loginForm) loginForm.classList.remove('loading');
    });
  }

  // Handle form submission
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();

      const token = loginTokenInput ? loginTokenInput.value.trim() : '';

      if (!token) {
        showError('Please enter your access token');
        $('#loginToken').focus();
        return;
      }

      loginForm.classList.add('loading');

      setTimeout(() => {
        if (isAdminLogin) {
          handleAdminLogin(token, true);
        } else {
          handleRegularLogin(token, true);
        }

        loginForm.classList.remove('loading');
      }, 1000);
    });
  }

  // Logout
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

  // --- PROTECTED EVENT LISTENERS START HERE ---

  safeEventListener('pairphoneinput', 'keypress', function (e) {
    if (e.key === 'Enter') {
      const pairPhoneInput = document.getElementById('pairphoneinput');
      const phone = pairPhoneInput.value.trim();
      if (phone) {
        connect().then((data) => {
          if (data.success == true) {
            pairPhone(phone)
              .then((data) => {
                document.getElementById('pairHelp').classList.add('hidden');;
                if (data.success && data.data && data.data.LinkingCode) {
                  document.getElementById('pairInfo').innerHTML = `Your link code is: ${data.data.LinkingCode}`;
                  scanInterval = setInterval(checkStatus, 1000);
                } else {
                  document.getElementById('pairInfo').innerHTML = "Problem getting pairing code";
                }
              })
              .catch((error) => {
                document.getElementById('pairInfo').innerHTML = "Problem getting pairing code";
                console.error('Pairing error:', error);
              });
          }
        });
      }
    }
  });

  safeEventListener('userinfoinput', 'keypress', function (e) {
    if (e.key === 'Enter') doUserInfo();
  });

  safeEventListener('useravatarinput', 'keypress', function (e) {
    if (e.key === 'Enter') doUserAvatar();
  });

  safeEventListener('userInfo', 'click', function () {
    document.getElementById('userInfoContainer').innerHTML = '';
    document.getElementById("userInfoContainer").classList.add('hidden');
    $('#modalUserInfo').modal({
      onApprove: function () {
        doUserInfo();
        return false;
      }
    }).modal('show');
  });

  safeEventListener('userAvatar', 'click', function () {
    document.getElementById('userAvatarContainer').innerHTML = '';
    document.getElementById("userAvatarContainer").classList.add('hidden');
    $('#modalUserAvatar').modal({
      onApprove: function () {
        doUserAvatar();
        return false;
      }
    }).modal('show');
  });

  safeEventListener('sendTextMessage', 'click', function () {
    document.getElementById('sendMessageContainer').innerHTML = '';
    document.getElementById("sendMessageContainer").classList.add('hidden');
    $('#modalSendTextMessage').modal({
      onApprove: function () {
        sendTextMessage().then((result) => {
          document.getElementById("sendMessageContainer").classList.remove('hidden');
          if (result.success === true) {
            document.getElementById('sendMessageContainer').innerHTML = `Message sent successfully. Id: ${result.data.Id}`
          } else {
            document.getElementById('sendMessageContainer').innerHTML = `Problem sending message: ${result.error}`
          }
        });
        return false;
      }
    }).modal('show');
  });

  safeEventListener('deleteMessage', 'click', function () {
    document.getElementById('deleteMessageContainer').innerHTML = '';
    document.getElementById("deleteMessageContainer").classList.add('hidden');
    $('#modalDeleteMessage').modal({
      onApprove: function () {
        deleteMessage().then((result) => {
          console.log(result);
          document.getElementById("deleteMessageContainer").classList.remove('hidden');
          if (result.success === true) {
            document.getElementById('deleteMessageContainer').innerHTML = `Message deleted successfully.`
          } else {
            document.getElementById('deleteMessageContainer').innerHTML = `Problem deleting message: ${result.error}`
          }
        });
        return false;
      }
    }).modal('show');
  });

  safeEventListener('userContacts', 'click', function () {
    getContacts();
  });

  // Configurations
  safeEventListener('s3Config', 'click', function () {
    $('#modalS3Config').modal({
      onApprove: function () {
        saveS3Config();
        return false;
      }
    }).modal('show');
    loadS3Config();
  });

  safeEventListener('historyConfig', 'click', function () {
    $('#modalHistoryConfig').modal({
      onApprove: function () {
        saveHistoryConfig();
        return false;
      }
    }).modal('show');
    loadHistoryConfig();
  });

  safeEventListener('proxyConfig', 'click', function () {
    $('#modalProxyConfig').modal({
      onApprove: function () {
        saveProxyConfig();
        return false;
      }
    }).modal('show');
    loadProxyConfig();
  });

  safeEventListener('webhookConfig', 'click', function () {
    webhookModal();
  });

  safeEventListener('testS3Connection', 'click', function () {
    testS3Connection();
  });

  safeEventListener('deleteS3Config', 'click', function () {
    deleteS3Config();
  });

  safeEventListener('hmacConfig', 'click', function () {
    $('#modalHmacConfig').modal({
      onApprove: function () {
        saveHmacConfig();
        return false;
      }
    }).modal('show');
    loadHmacConfig();
  });

  // Chatwoot Configuration
  safeEventListener('chatwootConfig', 'click', function () {
    $('#modalChatwootConfig').modal({
      onApprove: function () {
        saveChatwootConfig();
        return false;
      }
    }).modal('show');
    loadChatwootConfig();
  });

  safeEventListener('generateHmacKey', 'click', function () {
    generateRandomHmacKey();
  });

  safeEventListener('showHmacKey', 'click', function () {
    toggleHmacKeyVisibility();
  });

  safeEventListener('hideHmacKey', 'click', function () {
    toggleHmacKeyVisibility();
  });

  safeEventListener('deleteHmacConfig', 'click', function () {
    deleteHmacConfig();
  });

  safeEventListener('generateHmacKeyInstance', 'click', function () {
    generateRandomHmacKeyInstance();
  });

  safeEventListener('showHmacKeyInstance', 'click', function () {
    toggleHmacKeyVisibilityInstance();
  });

  safeEventListener('hideHmacKeyInstance', 'click', function () {
    toggleHmacKeyVisibilityInstance();
  });

  $('#addInstanceButton').click(function () {
    $('#addInstanceModal').modal({
      onApprove: function (e, pp) {
        $('#addInstanceForm').submit();
        return false;
      }
    }).modal('show');
  });

  $('#addInstanceForm').form({
    fields: {
      name: {
        identifier: 'name',
        rules: [{
          type: 'empty',
          prompt: 'Please enter a name for the instance'
        }]
      },
      token: {
        identifier: 'token',
        rules: [{
          type: 'empty',
          prompt: 'Please enter an authentication token for the instance'
        }]
      },
      events: {
        identifier: 'events',
        rules: [{
          type: 'empty',
          prompt: 'Please select at least one event'
        }]
      },
      history: {
        identifier: 'history',
        optional: true,
        rules: [{
          type: 'integer[0..]',
          prompt: 'History must be a non-negative integer'
        }]
      },
      proxy_url: {
        identifier: 'proxy_url',
        optional: true,
        rules: [{
          type: 'regExp[^(https?|socks5)://.*]',
          prompt: 'Proxy URL must start with http://, https://, or socks5://'
        }]
      },
      s3_endpoint: {
        identifier: 's3_endpoint',
        optional: true,
        rules: [{
          type: 'url',
          prompt: 'Please enter a valid S3 endpoint URL'
        }]
      },
      s3_bucket: {
        identifier: 's3_bucket',
        optional: true,
        rules: [{
          type: 'regExp[^[a-z0-9][a-z0-9.-]*[a-z0-9]$]',
          prompt: 'Please enter a valid S3 bucket name'
        }]
      }
    },
    onSuccess: function (event, fields) {
      event.preventDefault();

      // Validate conditional fields
      const proxyEnabled = fields.proxy_enabled === 'on' || fields.proxy_enabled === true;
      const s3Enabled = fields.s3_enabled === 'on' || fields.s3_enabled === true;
      const hmacEnabled = fields.hmac_enabled === 'on' || fields.hmac_enabled === true;

      if (proxyEnabled && !fields.proxy_url) {
        showError('Proxy URL is required when proxy is enabled');
        return false;
      }

      if (s3Enabled) {
        if (!fields.s3_bucket) {
          showError('S3 bucket name is required when S3 is enabled');
          return false;
        }
        if (!fields.s3_access_key) {
          showError('S3 access key is required when S3 is enabled');
          return false;
        }
        if (!fields.s3_secret_key) {
          showError('S3 secret key is required when S3 is enabled');
          return false;
        }
      }

      if (hmacEnabled && !fields.hmac_key) {
        showError('HMAC key is required when HMAC is enabled');
        return false;
      }

      if (hmacEnabled && fields.hmac_key && fields.hmac_key.length < 32) {
        showError('HMAC key must be at least 32 characters long');
        return false;
      }

      addInstance(fields).then((result) => {
        if (result.success) {
          showSuccess('Instance created successfully');
          // Refresh the instances list
          updateAdmin();
        } else {
          showError('Failed to create instance: ' + (result.error || 'Unknown error'));
        }
      }).catch((error) => {
        showError('Error creating instance: ' + error.message);
      });

      $('#addInstanceModal').modal('hide');
      $('#addInstanceForm').form('reset');
      $('.ui.dropdown').dropdown('restore defaults');
      // Reset toggles
      $('#addInstanceProxyToggle').checkbox('set unchecked');
      $('#addInstanceS3Toggle').checkbox('set unchecked');
      $('#addInstanceHmacToggle').checkbox('set unchecked');
      $('#addInstanceProxyUrlField').hide();
      $('#addInstanceS3Fields').hide();
      $('#addInstanceHmacKeyWarningMessage').hide();
      $('#addInstanceHmacKeyField').hide();
    }
  });

  init();
});

// ... RESTO DO CÓDIGO (async functions) PERMANECE IGUAL ...
// (Mantenha todas as funções async addInstance, loadChatwootConfig, etc., que vêm depois do init() do arquivo original)
async function addInstance(data) {
  // ... (o conteúdo desta função é o mesmo do seu arquivo original)
  console.log("Add Instance...");
  const admintoken = getLocalStorageItem('admintoken');
  const myHeaders = new Headers();
  myHeaders.append('authorization', admintoken);
  myHeaders.append('Content-Type', 'application/json');

  // Build proxy configuration
  const proxyEnabled = data.proxy_enabled === 'on' || data.proxy_enabled === true;
  const proxyConfig = {
    enabled: proxyEnabled,
    proxyURL: proxyEnabled ? (data.proxy_url || '') : ''
  };

  // Build S3 configuration
  const s3Enabled = data.s3_enabled === 'on' || data.s3_enabled === true;
  const s3PathStyle = data.s3_path_style === 'on' || data.s3_path_style === true;
  const s3Config = {
    enabled: s3Enabled,
    endpoint: s3Enabled ? (data.s3_endpoint || '') : '',
    region: s3Enabled ? (data.s3_region || '') : '',
    bucket: s3Enabled ? (data.s3_bucket || '') : '',
    accessKey: s3Enabled ? (data.s3_access_key || '') : '',
    secretKey: s3Enabled ? (data.s3_secret_key || '') : '',
    pathStyle: s3PathStyle,
    publicURL: s3Enabled ? (data.s3_public_url || '') : '',
    mediaDelivery: s3Enabled ? (data.s3_media_delivery || 'base64') : 'base64',
    retentionDays: s3Enabled ? (parseInt(data.s3_retention_days) || 30) : 30
  };

  // Build HMAC configuration
  const hmacEnabled = data.hmac_enabled === 'on' || data.hmac_enabled === true;
  const hmacKey = hmacEnabled ? (data.hmac_key || '') : '';

  const payload = {
    name: data.name,
    token: data.token,
    events: data.events.join(','),
    webhook: data.webhook_url || '',
    expiration: 0,
    history: parseInt(data.history) || 0,
    proxyConfig: proxyConfig,
    s3Config: s3Config,
    hmacKey: hmacKey
  };

  console.log("Payload being sent:", payload);

  res = await fetch(baseUrl + "/admin/users", {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify(payload)
  });

  const responseData = await res.json();
  console.log("Response:", responseData);
  return responseData;
}

// ... COPIE E COLE TODAS AS FUNÇÕES DEPOIS DO DOMContentLoaded DO SEU ARQUIVO ORIGINAL AQUI ...
// (Para não ficar gigante a resposta, assumo que você manterá o resto do arquivo igual)