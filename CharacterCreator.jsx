// src/CharacterCreator.jsx
//
// Component for creating Dungeons & Dragons characters by
// fetching data from the open D&D 5e API. It allows users to
// select a race from the API, view the racial bonuses and traits,
// adjust ability scores, enter basic details (name, gender, level),
// and display a finished character profile with a corresponding
// illustration. This component is intended to be used after
// authentication – see AuthComponent.jsx for login logic.

import React, { useState, useEffect } from 'react';

// Mapping of race indices to local artwork. To use artwork in your
// project, place image files in your public folder (e.g.
// public/images/dwarf.png). The keys should correspond to the
// race index returned by the API. Feel free to extend this map
// with additional images.
const raceImages = {
  dwarf: '/images/dwarf.png',
  elf: '/images/elf.png',
  halfling: '/images/halfling.png',
  human: '/images/human.png',
  dragonborn: '/images/dragonborn.png',
  gnome: '/images/gnome.png',
  half_elf: '/images/half_elf.png',
  half_orc: '/images/half_orc.png',
  tiefling: '/images/tiefling.png',
};

/**
 * Utility function to generate a blank ability score object.
 * Base scores can be adjusted as needed; D&D uses point-buy or
 * rolling mechanics, but a default of 10 across the board is
 * reasonable as a starting point.
 */
const getDefaultAbilities = () => ({
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
});

/**
 * CharacterProfile component
 * Displays a summary of the created character, including
 * race information, ability scores (with bonuses), and
 * the selected portrait. A back button allows users to
 * return and make changes.
 */
const CharacterProfile = ({
  character,
  raceDetails,
  onBack,
}) => {
  const {
    name,
    gender,
    level,
    raceIndex,
    abilities,
  } = character;
  const raceName = raceDetails?.name || raceIndex;
  // Determine portrait based on race index
  const portrait = raceImages[raceIndex] || '/images/default.png';

  return (
    <div className="max-w-xl mx-auto p-6 bg-white rounded-lg shadow-md space-y-4">
      <h2 className="text-2xl font-bold text-center">Character Profile</h2>
      <div className="flex flex-col items-center">
        <img
          src={portrait}
          alt={`${raceName} portrait`}
          className="w-32 h-32 object-cover mb-4 border border-gray-200 rounded-full"
        />
        <h3 className="text-xl font-semibold">{name || 'Unnamed Adventurer'}</h3>
        <p className="text-gray-600">
          {gender ? `${gender}, ` : ''}
          Level {level || 1} {raceName}
        </p>
      </div>
      <h4 className="font-semibold">Ability Scores</h4>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {Object.entries(abilities).map(([ability, score]) => (
          <li key={ability} className="flex justify-between">
            <span className="capitalize">{ability}</span>
            <span className="font-mono font-semibold">{score}</span>
          </li>
        ))}
      </ul>
      {raceDetails && (
        <div>
          <h4 className="font-semibold mt-4">Race Traits</h4>
          <p className="text-sm text-gray-700 whitespace-pre-line">
            {raceDetails.alignment}
          </p>
        </div>
      )}
      <button
        onClick={onBack}
        className="mt-4 py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Back to Creation
      </button>
    </div>
  );
};

/**
 * CharacterCreator component
 * Main UI for selecting a race, entering character details,
 * adjusting ability scores, and viewing the final profile.
 */
const CharacterCreator = () => {
  const [races, setRaces] = useState([]);
  const [loadingRaces, setLoadingRaces] = useState(true);
  const [racesError, setRacesError] = useState(null);

  const [selectedRace, setSelectedRace] = useState('');
  const [raceDetails, setRaceDetails] = useState(null);
  const [loadingRaceDetails, setLoadingRaceDetails] = useState(false);
  const [raceError, setRaceError] = useState(null);

  // Character state: name, gender, level, abilities
  const [characterName, setCharacterName] = useState('');
  const [gender, setGender] = useState('');
  const [level, setLevel] = useState(1);
  const [abilities, setAbilities] = useState(getDefaultAbilities());

  // Flag to show profile vs creation form
  const [showProfile, setShowProfile] = useState(false);

  // Fetch list of races on mount
  useEffect(() => {
    const fetchRaces = async () => {
      try {
        const res = await fetch('https://www.dnd5eapi.co/api/races');
        if (!res.ok) {
          throw new Error(`Failed to fetch races: ${res.status}`);
        }
        const data = await res.json();
        setRaces(data.results);
      } catch (err) {
        setRacesError(err.message);
      } finally {
        setLoadingRaces(false);
      }
    };
    fetchRaces();
  }, []);

  // Fetch details when selectedRace changes
  useEffect(() => {
    if (!selectedRace) return;
    setLoadingRaceDetails(true);
    setRaceError(null);
    const fetchRaceDetails = async () => {
      try {
        const res = await fetch(
          `https://www.dnd5eapi.co/api/races/${selectedRace}`
        );
        if (!res.ok) {
          throw new Error(`Failed to fetch race details: ${res.status}`);
        }
        const data = await res.json();
        setRaceDetails(data);
        // Apply ability bonuses to default abilities
        const base = getDefaultAbilities();
        const updated = { ...base };
        if (data.ability_bonuses) {
          data.ability_bonuses.forEach((bonusObj) => {
            const abilityIndex = bonusObj.ability_score.index; // e.g. 'str'
            const abilityName = {
              str: 'strength',
              dex: 'dexterity',
              con: 'constitution',
              int: 'intelligence',
              wis: 'wisdom',
              cha: 'charisma',
            }[abilityIndex];
            if (abilityName) {
              updated[abilityName] = base[abilityName] + bonusObj.bonus;
            }
          });
        }
        setAbilities(updated);
      } catch (err) {
        setRaceError(err.message);
      } finally {
        setLoadingRaceDetails(false);
      }
    };
    fetchRaceDetails();
  }, [selectedRace]);

  const handleAbilityChange = (ability, value) => {
    setAbilities((prev) => ({ ...prev, [ability]: parseInt(value, 10) || 0 }));
  };

  const handleCreate = () => {
    // Basic validation
    if (!selectedRace) {
      alert('Please select a race.');
      return;
    }
    setShowProfile(true);
  };

  const resetForm = () => {
    setShowProfile(false);
  };

  if (loadingRaces) {
    return <div>Loading races...</div>;
  }
  if (racesError) {
    return <div className="text-red-600">Error: {racesError}</div>;
  }

  if (showProfile) {
    const character = {
      name: characterName,
      gender,
      level,
      raceIndex: selectedRace,
      abilities,
    };
    return (
      <CharacterProfile
        character={character}
        raceDetails={raceDetails}
        onBack={resetForm}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md space-y-4">
      <h2 className="text-2xl font-bold">Character Creator</h2>
      {/* Race selection */}
      <div>
        <label className="block mb-1 font-semibold">Race</label>
        <select
          className="w-full border rounded px-3 py-2"
          value={selectedRace}
          onChange={(e) => setSelectedRace(e.target.value)}
        >
          <option value="">-- Choose a Race --</option>
          {races.map((race) => (
            <option key={race.index} value={race.index}>
              {race.name}
            </option>
          ))}
        </select>
        {loadingRaceDetails && <p>Loading race details...</p>}
        {raceError && <p className="text-red-600">Error: {raceError}</p>}
      </div>
      {/* Character info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block mb-1 font-semibold">Name</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2"
            value={characterName}
            onChange={(e) => setCharacterName(e.target.value)}
          />
        </div>
        <div>
          <label className="block mb-1 font-semibold">Gender</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
          />
        </div>
        <div>
          <label className="block mb-1 font-semibold">Level</label>
          <input
            type="number"
            min="1"
            className="w-full border rounded px-3 py-2"
            value={level}
            onChange={(e) => setLevel(parseInt(e.target.value, 10) || 1)}
          />
        </div>
      </div>
      {/* Ability scores */}
      <div>
        <h3 className="font-semibold mt-4 mb-2">Ability Scores</h3>
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(abilities).map(([ability, score]) => (
            <div key={ability}>
              <label className="block mb-1 capitalize font-medium">
                {ability}
              </label>
              <input
                type="number"
                className="w-full border rounded px-3 py-2"
                value={score}
                onChange={(e) =>
                  handleAbilityChange(ability, e.target.value)
                }
              />
            </div>
          ))}
        </div>
      </div>
      <button
        onClick={handleCreate}
        className="mt-4 py-2 px-4 bg-green-600 text-white rounded hover:bg-green-700"
      >
        Create Character
      </button>
    </div>
  );
};

export default CharacterCreator;