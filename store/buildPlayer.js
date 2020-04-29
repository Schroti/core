/* eslint-disable consistent-return */
const async = require('async');
const pify = require('pify');
const config = require('../config');
const processPlayerData = require('../processors/processPlayerData');
const getUUID = require('./getUUID');
const {
  logger, generateJob, getData, getPlayerFields,
} = require('../util/utility');
const redis = require('./redis');
const cachedFuction = require('./cachedFunction');
const queries = require('./queries');

/*
Functions to build/cache player object
Currently doesn't support search by name
 */
async function buildPlayer(uuid, { shouldCache = true } = {}) {
  return cachedFuction(`player:${uuid}`, async () => {
    const body = await getData(redis, generateJob('player', { id: uuid }).url);
    const playerData = await pify(processPlayerData)(body.player || {});

    if (shouldCache && config.ENABLE_DB_CACHE) {
      await queries.insertPlayer(uuid, playerData);
    }

    return playerData;
  }, {
    cacheDuration: config.PLAYER_CACHE_SECONDS,
    shouldCache: shouldCache && config.ENABLE_PLAYER_CACHE,
  });
}

async function getPlayer(name) {
  try {
    const uuid = await getUUID(name);
    try {
      return await buildPlayer(uuid);
    } catch (error) {
      return { status: 500, message: error.message };
    }
  } catch (error) {
    return { status: 404, message: error.message };
  }
}

async function populatePlayers(players) {
  return async.map(players, async (player) => {
    const { uuid } = player;
    try {
      const [profile, isCached] = pify(queries.getPlayerProfile, {
        multiArgs: true,
      })(uuid);
      if (profile === null) {
        logger.debug(`[populatePlayers] ${uuid} not found in DB, generating...`);
        const newPlayer = await pify(buildPlayer)();
        delete player.uuid;
        const profile = getPlayerFields(newPlayer);
        profile.uuid = uuid;
        player.profile = profile;
        await pify(queries.cachePlayerProfile)(profile);
        return player;
      }
      delete player.uuid;
      player.profile = profile;
      if (isCached) {
        return player;
      }
      await pify(queries.cachePlayerProfile)(profile);
      return player;
    } catch (error) {
      logger.error(error);
    }
  });
}

module.exports = { buildPlayer, getPlayer, populatePlayers };
