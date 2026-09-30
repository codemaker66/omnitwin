import assert from "node:assert/strict";
import { test } from "node:test";
import { integrateLandingBundle, transformLandingContent } from "./integrate-amissing-book-landing.mjs";

const event = "event:{first:'Under',second:'construction.',action:'Contact our team',url:'mailto:info@tradeshallglasgow.co.uk'}";
const stories = "const stories = [{name:'Bakers',text:'Retained Craft story',sourceUrl:'https://www.tradeshouse.org.uk/'}];";
const layout = ".oh-story-reserve { visibility:hidden; grid-area:1/1; }";
const oldCraft = "craft:{first:'Find your',second:'people.',eyebrow:'Fourteen Crafts. One living tradition.',subtitle:['Discover the Craft that connects','with who you are.'],label:'THE CRAFT QUIZ',description:['A little about you. A living tradition.','Discover where your story belongs.'],action:'Discover my Craft',url:'https://venviewer.com/quiz'}";
const oldMetadata = "Discover your connection to the fourteen Incorporated Crafts or contact Trades Hall of Glasgow to plan an event.";
const card = '<a href="https://venviewer.com/quiz" data-intent="craft"><span class="oh-choice-title">Find your Craft</span><span class="oh-choice-description">Take the quiz. Find your people.</span></a>';
const fixture = [event, stories, layout, oldCraft, oldMetadata, card].join("\r\n");

test("updates the two-stage game introduction while preserving all other source bytes", () => {
  const result = transformLandingContent(fixture);
  const expectedCraft = "craft:{first:'The Amissing',second:'Book',eyebrow:'Fourteen Crafts. One living tradition.',subtitle:['An interactive story about Glasgow’s','14 Incorporated Crafts.'],label:'THE AMISSING BOOK',description:['An interactive story about Glasgow’s','14 Incorporated Crafts.'],action:'Play the game',url:'https://venviewer.com/quiz'}";
  const expectedMetadata = "Play The Amissing Book, an interactive story about Glasgow’s 14 Incorporated Crafts, or contact Trades Hall of Glasgow to plan an event.";
  const expectedCard = '<a href="https://venviewer.com/quiz" data-intent="craft"><span class="oh-choice-title">Find your Craft</span><span class="oh-choice-description">Play the interactive game.</span></a>';
  assert.equal(result, [event, stories, layout, expectedCraft, expectedMetadata, expectedCard].join("\r\n"));
  assert.doesNotMatch(result, /Take the quiz|THE CRAFT QUIZ|Discover my Craft/);
});

test("refuses incomplete or ambiguous source fragments", () => {
  assert.throws(() => transformLandingContent(fixture.replace(oldCraft, "")), /Expected exactly one/);
  assert.throws(() => transformLandingContent(`${fixture}\n${card}`), /Expected exactly one/);
  assert.throws(() => transformLandingContent(transformLandingContent(fixture)), /Expected exactly one/);
});

test("requires the exact frozen public bundle before publishing any transformed content", () => {
  assert.throws(() => integrateLandingBundle(Buffer.from(fixture)), /Landing source drift/);
  assert.throws(() => integrateLandingBundle(Buffer.from("")), /Landing source drift/);
});
