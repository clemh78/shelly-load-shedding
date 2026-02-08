# Load Shedder Integration Tests

Tests d'intégration pour `load-shedder.js` s'exécutant sur un **Shelly Pro 3EM réel** avec injection de status via HTTP.

## 🏗️ Architecture

```
┌─────────────────────┐         ┌──────────────────────┐         ┌─────────────────┐
│   Test Scenarios    │────────>│  Shelly Pro 3EM      │<───────>│  Pro3 Mock      │
│   (Node.js/PC)      │  HTTP   │  + load-shedder.js   │ HTTP    │  Server         │
│                     │         │  (TEST_MODE=true)    │         │  (Node.js/PC)   │
└─────────────────────┘         └──────────────────────┘         └─────────────────┘
         │                               │
         │                               │
         └───────────── MQTT ────────────┘
           (observation des events)
```

### Composants

1. **load-shedder.js** (sur Shelly Pro 3EM)
   - Exécution réelle sur le matériel
   - `CONFIG.TEST_MODE = true` active l'endpoint HTTP
   - Endpoint : `/script/{SCRIPT_ID}/inject-status`
   - Traite les status injectés via la même stack que la prod

2. **Pro3 Mock Server** (`test-server.js`)
   - Mock du Pro3 (répond aux heartbeats)
   - Simule les états des relays
   - Peut simuler des pannes (offline mode)

3. **Test Scenarios** (`scenarios.js`)
   - Scénarios de test interactifs
   - Injecte des mesures EM via HTTP
   - Observe les résultats via logs et MQTT

## 📋 Prérequis

1. **Shelly Pro 3EM** accessible sur le réseau
2. **Node.js** installé sur votre PC
3. **MQTT** broker si vous voulez observer les events

## 🚀 Installation

```bash
cd test
npm install
```

## ⚙️ Configuration

### 1. Modifier load-shedder.js

Activer le mode test dans la configuration :

```javascript
let CONFIG = {
  // ... autres configs ...

  // 🧪 TEST MODE
  TEST_MODE: true,  // ← Activer pour les tests

  // Debug recommandé pour les tests
  DEBUG: true,
  DRY_RUN: false,   // Mettre à false pour tester les vraies commandes relay
};
```

**⚠️ Important** : Changer `PRO3_IP` pour pointer vers le mock server !

```javascript
PRO3_IP: "192.168.1.200:3100",  // IP de votre PC + port 3100
```

### 2. Déployer sur le Shelly

1. Aller sur l'interface web du Shelly : `http://[SHELLY_IP]`
2. Scripts → Add/Edit script
3. Coller le contenu de `load-shedder.js`
4. Save et noter le **Script ID** (généralement 1)

### 3. Configurer les variables d'environnement

```bash
# IP du Shelly Pro 3EM
export SHELLY_IP="192.168.1.100"

# Script ID (visible dans l'URL du script)
export SHELLY_SCRIPT_ID="1"
```

Ou créer un fichier `.env` :
```bash
SHELLY_IP=192.168.1.100
SHELLY_SCRIPT_ID=1
```

## 🧪 Utilisation

### Démarrage rapide

**Terminal 1** - Démarrer le Pro3 mock :
```bash
cd test
node test-server.js
```

Vous devriez voir :
```
╔══════════════════════════════════════════════════════════════════════════════╗
║                         PRO3 MOCK SERVER                                     ║
╚══════════════════════════════════════════════════════════════════════════════╝

🔌 Pro3 Mock running on http://localhost:3100
🎯 Target Shelly: http://192.168.1.100
📝 Script ID: 1
```

**Terminal 2** - Lancer les scénarios :
```bash
cd test
node scenarios.js
```

Menu interactif :
```
Available scenarios:
   1 - Normal Operation
   2 - Progressive Overload
   3 - Immediate Shedding
   4 - Restoration
   5 - Pro3 Connection Loss
   6 - Multi-Phase Overload
   7 - Overload Cancellation
   A - Run all scenarios
   Q - Quit

Choose scenario:
```

### Lancer un scénario spécifique

```bash
# Scénario 2 : Progressive Overload
node scenarios.js 2

# Tous les scénarios
node scenarios.js A
```

### Test manuel avec curl

```bash
# Injecter une surcharge immédiate sur L1
curl -X POST http://192.168.1.100/script/1/inject-status \
  -H "Content-Type: application/json" \
  -d '{
    "component": "em:0",
    "delta": {
      "a_current": 35,
      "b_current": 20,
      "c_current": 20
    }
  }'

# Simuler déconnexion Ethernet
curl -X POST http://192.168.1.100/script/1/inject-status \
  -H "Content-Type: application/json" \
  -d '{
    "component": "eth",
    "delta": {
      "ip": null
    }
  }'
```

## 📊 Scénarios de test

### 1. Normal Operation
- Injection de courants normaux (20A)
- Vérification : Aucun délestage, tout reste ON

### 2. Progressive Overload
- Overload progressif (29A > 28A threshold)
- Vérification : Délestage après 2s de délai

### 3. Immediate Shedding
- Overload critique (35A > 33.6A = 120% threshold)
- Vérification : Délestage immédiat, pas de délai

### 4. Restoration
- Délestage puis réduction du courant
- Vérification : Restauration après 5 minutes (configurable)

### 5. Pro3 Connection Loss
- Simulation de perte de connexion Pro3
- Vérification : Détection offline, relays unknown

### 6. Multi-Phase Overload
- Overload simultané sur les 3 phases
- Vérification : Les 3 phases délestées

### 7. Overload Cancellation
- Overload qui se résout avant le délai
- Vérification : Pas de délestage, overload annulé

## 🔍 Observation des résultats

### 1. Logs Shelly
Aller sur l'interface web : `http://[SHELLY_IP]/` → Scripts → [Votre script] → Console

Vous verrez :
```
[PRO3EM] 🧪 TEST MODE ENABLED - Registering HTTP endpoint for status injection
[PRO3EM] 🧪 TEST: HTTP endpoint available at /script/1/inject-status
[PRO3EM] 🧪 TEST: Status injected via HTTP endpoint
[PRO3EM] Measurements: [OK]L1=29.00A(on)  [OK]L2=20.00A(on)  [OK]L3=20.00A(on)
[PRO3EM] OVERLOAD detected L1: 29.00A > 28A
[PRO3EM] SHEDDING L1 (overload for 2.1s)
[PRO3EM] ACTION: L1 -> OFF
```

### 2. MQTT Messages
Écouter les topics :
```bash
# Events
mosquitto_sub -t "load-shedding-dev/events"

# États des phases
mosquitto_sub -t "load-shedding-dev/+/state"

# Status global
mosquitto_sub -t "load-shedding-dev/status"
```

### 3. Pro3 Mock Logs
Dans le terminal du mock server :
```
💓 Heartbeat received - Relays: [ON, ON, ON]
🔄 Relay 0 command: ON → OFF
💓 Heartbeat received - Relays: [OFF, ON, ON]
```

## 🎛️ Contrôle du Mock Server

```bash
# Voir l'état actuel
curl http://localhost:3100/status

# Forcer un relay OFF (simulation)
curl -X POST http://localhost:3100/set-relay \
  -H "Content-Type: application/json" \
  -d '{"relayId": 0, "state": false}'

# Simuler Pro3 offline
curl -X POST http://localhost:3100/set-online \
  -H "Content-Type: application/json" \
  -d '{"online": false}'

# Remettre Pro3 online
curl -X POST http://localhost:3100/set-online \
  -H "Content-Type: application/json" \
  -d '{"online": true}'
```

## ⚡ Tests rapides

Pour des tests plus rapides, modifier temporairement dans `load-shedder.js` :

```javascript
CONFIG = {
  SHEDDING_DELAY: 2000,        // Déjà court (2s)
  RESTORATION_DELAY: 10000,    // Réduire de 300000 (5min) à 10000 (10s)
  HEARTBEAT_INTERVAL: 5000,    // Réduire de 10000 à 5000
};
```

**⚠️ NE PAS commiter ces valeurs en production !**

## 🐛 Dépannage

### Le mock server ne reçoit pas de heartbeats

1. Vérifier que `PRO3_IP` dans load-shedder.js pointe vers le mock :
   ```javascript
   PRO3_IP: "192.168.1.200:3100"  // IP de votre PC
   ```

2. Vérifier que le Shelly peut atteindre votre PC :
   ```bash
   # Depuis l'interface Shelly, tester :
   ping 192.168.1.200
   ```

3. Vérifier le firewall de votre PC (autoriser port 3100)

### L'injection de status échoue

1. Vérifier que `TEST_MODE = true` dans load-shedder.js
2. Vérifier que le script est déployé et running sur le Shelly
3. Tester avec curl :
   ```bash
   curl -v http://[SHELLY_IP]/script/1/inject-status
   ```

### Les relays ne répondent pas

1. Vérifier `DRY_RUN = false` dans load-shedder.js
2. Vérifier que le mock server est en mode online
3. Vérifier les logs du mock server pour les commandes relay

## 📝 Différences avec la V1 (mocks Node.js)

| Aspect | V1 (Mocks) | V2 (Shelly réel) |
|--------|------------|------------------|
| Exécution | Node.js (PC) | Shelly Pro 3EM réel |
| API Shelly | Mockée | Vraie |
| Relays | Simulés | Vrais (ou Pro3 mock) |
| Performance | Rapide | Réaliste |
| Setup | Simple | Nécessite matériel |
| Use case | Tests unitaires | Tests d'intégration |

**Recommandation** : Utiliser les deux !
- **V1** pour tests rapides pendant le développement
- **V2** pour validation finale avant déploiement en prod

## 🔒 Sécurité

**⚠️ IMPORTANT** : Ne pas laisser `TEST_MODE = true` en production !

- Le mode test expose un endpoint HTTP sans authentification
- N'importe qui sur le réseau peut injecter des status
- Toujours remettre `TEST_MODE = false` après les tests

## 📚 Ressources

- [Documentation Shelly Scripting](https://shelly-api-docs.shelly.cloud/gen2/Scripts/Tutorial)
- [HTTPServer API](https://shelly-api-docs.shelly.cloud/gen2/Scripts/HTTPServer)
- Script principal : [`../load-shedder.js`](../load-shedder.js)

## 🤝 Contribution

Pour ajouter un nouveau scénario :

```javascript
async function scenarioX_myTest() {
  printHeader('SCENARIO X: My Test');

  console.log('\n📤 Step 1: ...');
  await injectStatus(l1, l2, l3);
  await sleep(1000);

  console.log('\n📋 Expected results:');
  console.log('   - ...');

  return true;
}
```

Puis l'ajouter au menu dans la fonction `main()`.
