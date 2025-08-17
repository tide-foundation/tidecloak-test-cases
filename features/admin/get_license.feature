Feature: Add Tide as Identity provider and get license in Tidecloak
    As a Tide Cloak admin user
    I want Tide as am Identity provider

  Scenario: Admin adds Tide provider to "testrealm" and get license
    Given the admin is logged in to the Tidecloak admin console
    When the admin adds Tide provider to "testrealm" and get license
    Then the realm "testrealm" should have a visible license details