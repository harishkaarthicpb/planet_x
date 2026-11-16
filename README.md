Hi!

My name is Harish, and this is my submission to the "Planet X and SPHEREx" challenge at the NASA International Space Apps Challenge 2026!

Before I say anything, this is my first time making a "public" README, so please excuse any mistakes. And now, to the main event. 

🚀 How to Access Planet X

There are three ways to access and experience this project.

1. 🌐 Live Website (Recommended)

Click here to launch Planet X

This is the easiest way to experience the application. No installation is required.

2. 📦 Downloadable Version (Backup)

If the website is unavailable or doesn't work as expected, a downloadable version of the project is also available.

Download Planet X

[Add any installation or launch instructions required for the downloadable version.]

3. 💻 Run Locally (Final Backup)

If neither of the above options works, you can clone the repository and run the project locally.

Step 1: Clone the repository.

git clone https://github.com/harishkaarthicpb/planet_x.git

Step 2: Open the project folder in Android Studio or another suitable development environment with Node.js installed.

Step 3: Open a terminal in the project directory and run:

npm install
npm start

Step 4: Once the application starts, open:

http://localhost:8000

The application should now be accessible locally.

🙏 A Small Request to the Judges

If one of the methods above doesn't work, I kindly request that you try one of the alternatives before moving on.

I've provided multiple ways to access Planet X to make the project as accessible as possible.

I sincerely apologize for any inconvenience, and I really appreciate your time and consideration!

ABOUT THE APP:


**Planet X** is an interactive sky explorer built using astronomical data from NASA's SPHEREx mission and other sky surveys.

Here's how it works!

### 🌌 1. Explore the Sky

Know exactly what you're looking for?

Simply enter the **Right Ascension (RA)** and **Declination (Dec)** coordinates of your desired location, and Planet X will take you straight there!

You can also adjust the **Field of View (FOV)** to control how much of the surrounding sky you want to see.

Once you're there, you can explore the region across different infrared wavelengths or investigate observations taken at different times.

**Not sure what you're looking for?**

No problem! Just move around the sky, zoom in, and tap on anything that catches your interest.

Planet X integrates with the **SIMBAD astronomical database** to search for nearby objects and provide information about what you might be looking at, including names, object types, coordinates, and links to additional information.

### 🔲 2. Select a Region and Investigate

Here's where things get interesting!

You can **draw a rectangle around any region of the sky** that you'd like to explore further.

Once you've selected your region, Planet X offers two exploration modes:

#### 🌈 Infrared Mode — Explore Different Wavelengths

Ever wondered what the same part of the sky looks like at different infrared wavelengths?

Using SPHEREx's **102 infrared bands**, Planet X retrieves available imagery of your selected region across your chosen wavelength range.

You can:

- Choose your starting and ending wavelengths.
- Explore the region at different infrared wavelengths.
- Play an animation cycling through the available bands.
- Pause or manually scrub through the wavelength sequence.

This allows you to compare how the appearance of a region changes across infrared wavelengths.

#### 📅 Time Mode — Explore Observations Across Time

Want to see how a region of the sky appears across different observation dates?

Planet X searches for available SPHEREx observations near the **center of your selected region** and retrieves matching dated images.

These observations are organized into an interactive photo timeline, where you can:

- Browse images captured on different dates.
- View dated thumbnails in a filmstrip.
- Play the observations as a sequence.
- Pause, rewind, or manually move between dates.
- Load additional matching observations.
- Hide unwanted frames and restore them later.

By comparing these snapshots, you can investigate differences between observations and look for possible changes over time.

**Important:** Apparent changes between frames do not automatically indicate that an astronomical object is moving.

### 🛰️ 3. Compare Different Sky Surveys

Want to see how the same location looks through different astronomical surveys?

Planet X lets you switch between:

- **SPHEREx**
- **WISE**
- **DSS2 Color**
- **Gaia DR3**

And here's the useful part:

**Your sky position and zoom level are preserved when switching surveys!**

This means you can explore a location using SPHEREx, switch to WISE or another survey, and immediately compare the same part of the sky without having to search for it again.

Keep in mind that these surveys collected their data at different times, so differences between their images shouldn't automatically be interpreted as changes or movement.

### 🌈 4. Explore the Whole Sky Across Infrared Wavelengths

You don't have to select a specific region to explore infrared wavelengths!

The **wavelength slider in the top-right corner** lets you explore the SPHEREx whole-sky view across its available infrared bands.

Simply move the slider to your preferred wavelength and see how the sky's appearance changes.

Wavelengths are displayed in **micrometres (µm)**.

This gives you a way to investigate the sky across different portions of the infrared spectrum, all from the main viewing interface.

### 🧭 5. Additional Features

To make exploring the sky easier, Planet X also includes:

- **Guided Quick Tour:** An interactive introduction explaining the main controls. You can replay it through *Sky tools → Quick tour*.
- **Coordinate Readout:** View the sky coordinates beneath your cursor.
- **Search Marker:** Show or hide the marker indicating your searched location.
- **Object Lookup:** Search SIMBAD for nearby catalog matches when tapping objects in the SPHEREx whole-sky view.
- **Proper-Motion Adjustment:** Where measurements are available, approximately account for the movement of stars when matching objects.
- **Observation Dates:** See available observation dates and distinguish them from map publication dates.
- **Data Source Links:** Access the original astronomical archive observations.
- **Update Checks:** Check for compatible published SPHEREx updates and newer observations.
- **Distraction-Free Viewing:** Collapse panels or press **H** to hide or restore the tools.
- **Loading and Retry Controls:** View progress indicators and retry requests when something doesn't load correctly.

### 🔬 A Note About the Data

Planet X uses astronomical imagery and observations from external scientific archives.

The availability of observations depends on the selected region, wavelength, and available archive data. Loading times may vary.

The infrared exploration feature compares images across wavelengths; it does not currently produce a brightness-versus-wavelength spectrum graph.

SIMBAD object identifications are approximate positional matches and should not be treated as confirmed identifications.

---

**The idea behind Planet X is simple: make exploring astronomical data feel less like operating complex scientific software and more like discovering the universe for yourself.**
