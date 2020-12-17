import puppeteer from 'puppeteer';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { timeStamp } from './logger';
import { ImageDTO, ImageExtension } from './types/images.types';
import { WebAPICallResult, WebClient } from '@slack/web-api';
import {gql, request} from 'graphql-request';

/**
 * Scrape for new Ultrawide wallpapers, download new posts
 * that aren't ads or NSFW.  Post the results to my slack sever.
 */

config({ path: path.resolve(__dirname, `../../.env`) });

const URL = `https://old.reddit.com/r/widescreenwallpaper`;
const Slackbot = new WebClient(process.env.LOGGER_SLACK_BOT);

function getCurrentWallpapers() {
    return new Promise((res, rej) => 
        request(process.env.NAS_ENDPOINT ?? `NULL`, gql`{
            images {
                name
            }
        }`).then(res).catch(rej)
    )
}

async function getNewWallpapers(): Promise<ImageDTO[]> {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: `networkidle0` });

  const results = await page.evaluate(() => {
    const allPosts = Array.from(document.querySelectorAll(`.thing`));
    const targetPosts = allPosts.filter(
      (post) =>
        post.getAttribute(`data-promoted`)?.trim().toLowerCase() !== `true` &&
        post.getAttribute(`data-nsfw`)?.trim().toLowerCase() !== `true`
    );

    return targetPosts.map((post) => ({
      url: post.getAttribute(`data-url`) ?? `NULL`,
      name:
        post
          .querySelector(`[data-event-action="title"]`)
          ?.textContent?.trim()
          .toLowerCase()
          .replace(/ /g, `-`)
          .replace(/\*/g, `-`)
          .replace(/\//g, `-`)
          .replace(/\[/g, `-`)
          .replace(/\]/g, `-`)
          .replace(/\|/g, `-`)
          .replace(/@/g, `-`) ?? `NULL`,
      ext:
        post.getAttribute(`data-url`)?.split(`.`)[
          post.getAttribute(`data-url`)?.split(`.`).length - 1
        ] ?? `NULL`,
    }));
  });

  await browser.close();
  return results;
}

function downloadImage(
  result: ImageDTO
): Promise<{ name: string; success: boolean }> {
  const { url, name, ext } = result;
  return new Promise((res) => {
    const dest = path.join(
      process.env.BACKGROUNDS_DIR ?? `NULL`,
      `${name}.${ext}`
    );
    const file = fs.createWriteStream(dest);
    return https
      .get(url, (response) => {
        response.pipe(file);
        file.on(`finish`, () => {
          file.close();
          res({ name, success: true });
        });
      })
      .on(`error`, (_err) =>
        fs.unlink(dest, () => res({ name, success: false }))
      );
  });
}

function slackPost(bot: WebClient, text: string): Promise<void | WebAPICallResult> {
  return new Promise((res) =>
    bot.chat
      .postMessage({ channel: `backgrounds`, text })
      .then(res)
      .catch((err) => {
        console.error(err);
        res();
      })
  );
}

Promise.all([
  getNewWallpapers(),
  getCurrentWallpapers()
])
  .then(([newResults, current]) => {
    const downloads = newResults.filter(
      ({ name, ext }) =>
        !current.has(name) && Object.keys(ImageExtension).includes(ext)
    );
    return Promise.all(downloads.map(downloadImage));
  })
  .then((newDownloads) =>
    Promise.all(
      newDownloads.map(({ name, success }) =>
        slackPost(
          Slackbot,
          `${timeStamp()} -- ${
            success ? `${name} was downloaded` : `${name} was not downloaded`
          }`
        )
      )
    )
  )
  .catch((err) =>
    slackPost(
      Slackbot,
      `${timeStamp()} -- Error running getRedditBackgrounds:\n${err}`
    )
  );
